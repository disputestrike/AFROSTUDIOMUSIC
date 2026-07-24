"""AfroHit music trainer — Cog `train()` wrapping ACE-Step v1 (3.5B) LoRA.

Contract (matches packages/ai/src/music-trainer.ts + the nightly flywheel):
  input  dataset_zip : zip of rights-clean audio (the flywheel's manifest zip;
                       audio files, optionally sidecar lyrics/prompt text beside each)
  output weights.zip : the trained LoRA adapter directory, zipped

Flow (per ACE-Step v1 TRAIN_INSTRUCTION.md — the documented, buildable path):
  1. unzip -> conform each source to 44.1k mp3, sliced to 30-110s segments
  2. write the STRICT v1 data layout the converter demands, per segment:
        <key>.mp3  +  <key>_prompt.txt (tags)  +  <key>_lyrics.txt
  3. convert2hf_dataset.py -> HuggingFace dataset dir
  4. trainer.py -> LoRA adapter (base model + MERT/mHuBERT auto-download from HF)
  5. harvest the PEFT adapter (adapter_model.safetensors + adapter_config.json)
     from {logger_dir}/.../checkpoints/*_lora/, zip it, return it

HONESTY: every step runs the real ACE-Step v1 code. Empty dataset, thin corpus,
a nonzero trainer exit, or a run that produced no adapter each raise LOUDLY —
this wrapper NEVER fakes a training success or ships an empty adapter.
"""
import cog
from cog import BaseModel, Input
import math
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


class TrainingOutput(BaseModel):
    weights: cog.Path


AUDIO_EXTS = {".wav", ".mp3", ".flac", ".ogg", ".opus", ".m4a"}
ACE = Path("/src/ACE-Step")


def _sidecar(src: Path, *suffixes: str) -> str | None:
    """First existing sidecar text among <name><suffix> and <stem>_<word>.txt forms."""
    for suf in suffixes:
        cand = src.with_name(src.stem + suf)
        if cand.exists():
            txt = cand.read_text(encoding="utf-8", errors="ignore").strip()
            if txt:
                return txt
    return None


def _conform(src: Path, data_dir: Path, index: int, max_seg_s: int = 110) -> int:
    """44.1k mp3 sliced to 30-110s segments; each gets _prompt.txt + _lyrics.txt.

    Returns the number of segments written."""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(src)],
        capture_output=True, text=True,
    )
    try:
        duration = float(probe.stdout.strip())
    except ValueError:
        print(f"[trainer] skipping unreadable audio: {src.name}", file=sys.stderr)
        return 0
    if duration < 25:
        print(f"[trainer] skipping too-short clip ({duration:.0f}s): {src.name}", file=sys.stderr)
        return 0

    lyrics = _sidecar(src, ".lyrics.txt", "_lyrics.txt") or "[instrumental]"
    prompt = _sidecar(src, ".prompt.txt", "_prompt.txt", ".tags.txt")
    if not prompt:
        # No tags in the manifest yet. Emit a minimal, NON-misleading prompt
        # (never invent a genre we can't confirm) and warn loudly so the manifest
        # gets enriched with real per-track tags on the API side.
        has_lyrics = lyrics != "[instrumental]"
        prompt = "music, vocal" if has_lyrics else "music, instrumental"
        print(f"[trainer] WARN no prompt/tags sidecar for {src.name} — using generic "
              f"'{prompt}'. Enrich buildTrainingManifest to emit real tags.", file=sys.stderr)

    n_segs = max(1, int(duration // max_seg_s) + (1 if duration % max_seg_s >= 30 else 0))
    written = 0
    for s in range(n_segs):
        key = f"track{index:03d}_{s:02d}"
        mp3 = data_dir / f"{key}.mp3"
        cmd = ["ffmpeg", "-v", "error", "-y", "-ss", str(s * max_seg_s), "-t", str(max_seg_s),
               "-i", str(src), "-ar", "44100", "-ac", "2", "-b:a", "320k", str(mp3)]
        if subprocess.run(cmd).returncode == 0 and mp3.exists() and mp3.stat().st_size > 4096:
            (data_dir / f"{key}_prompt.txt").write_text(prompt, encoding="utf-8")
            (data_dir / f"{key}_lyrics.txt").write_text(lyrics, encoding="utf-8")
            written += 1
    return written


def _run(cmd: list[str], what: str) -> None:
    print(f"[trainer] {what}: {' '.join(cmd)}", flush=True)
    compat = Path(__file__).parent
    proc = subprocess.run(
        cmd,
        env={
            **os.environ,
            "PYTHONPATH": f"{compat}:{ACE}:{os.environ.get('PYTHONPATH', '')}",
        },
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"{what} exited {proc.returncode} — see log above. If the ACE-Step v1 CLI moved, "
            "repin the args here (this wrapper NEVER fakes success)."
        )


def train(
    dataset_zip: cog.Path = Input(description="Zip of rights-clean training audio (flywheel manifest zip)"),
    exp_name: str = Input(description="Adapter name", default="afrohit"),
    max_steps: int = Input(description="Training steps", default=800, ge=50, le=200000),
    every_n_train_steps: int = Input(description="Save the adapter every N steps", default=200, ge=10),
    learning_rate: float = Input(description="LR", default=1e-4),
    epochs: int = Input(description="Epochs (-1 = driven by max_steps)", default=-1),
    precision: str = Input(description="Trainer precision", default="bf16-mixed",
                           choices=["32", "16-mixed", "bf16-mixed"]),
    repeat_count: int = Input(description="Dataset repeat (0 = auto to ~2000 rows)", default=0, ge=0),
) -> TrainingOutput:
    work = Path(tempfile.mkdtemp(prefix="afh-train-"))
    raw, data, hf, out = work / "raw", work / "data", work / "hf", work / "out"
    for d in (raw, data, hf, out):
        d.mkdir(parents=True, exist_ok=True)

    # 1. unzip
    with zipfile.ZipFile(str(dataset_zip)) as z:
        z.extractall(raw)
    audio = sorted(p for p in raw.rglob("*") if p.suffix.lower() in AUDIO_EXTS)
    if not audio:
        raise RuntimeError("dataset_zip contained no audio files — refusing to fake a training run")
    print(f"[trainer] {len(audio)} source audio file(s)")

    # 2. conform into the strict v1 layout (<key>.mp3 + _prompt.txt + _lyrics.txt)
    kept = sum(_conform(src, data, i) for i, src in enumerate(audio))
    if kept < 3:
        raise RuntimeError(f"only {kept} usable 30s+ segments after conforming — corpus too thin to train honestly")
    print(f"[trainer] {kept} conformed segment(s) ready")

    # 3. convert to the HuggingFace dataset the trainer consumes
    repeat = repeat_count or max(1, min(2000, round(2000 / kept)))
    _run([sys.executable, str(ACE / "convert2hf_dataset.py"),
          "--data_dir", str(data), "--repeat_count", str(repeat), "--output_name", str(hf)],
         "convert2hf_dataset")
    if not any(hf.rglob("*.arrow")):
        raise RuntimeError("convert2hf_dataset produced no dataset arrow — aborting before a hollow train")

    # 4. train LoRA (base ACE-Step-v1-3.5B + MERT/mHuBERT auto-download from HF at runtime)
    cfg = ACE / "config" / "zh_rap_lora_config.json"  # genre-agnostic LoRA hyperparams
    if not cfg.exists():
        raise RuntimeError(f"missing LoRA config {cfg} — repin the build ref in cog.yaml")
    _run([sys.executable, str(ACE / "trainer.py"),
          "--dataset_path", str(hf),
          "--exp_name", exp_name,
          "--lora_config_path", str(cfg),
          "--learning_rate", str(learning_rate),
          "--epochs", str(epochs),
          "--max_steps", str(max_steps),
          "--every_n_train_steps", str(every_n_train_steps),
          "--precision", precision,
          "--devices", "1",
          "--logger_dir", str(out)],
         "trainer")

    # 5. harvest the newest PEFT adapter dir (adapter_model.safetensors + adapter_config.json)
    adapters = sorted(out.rglob("adapter_model.safetensors"), key=lambda p: p.stat().st_mtime)
    if not adapters:
        raise RuntimeError("trainer exited 0 but wrote no adapter_model.safetensors — refusing to ship an empty adapter")
    adapter_dir = adapters[-1].parent
    files = [p for p in adapter_dir.rglob("*") if p.is_file()]
    weights_zip = work / "weights.zip"
    with zipfile.ZipFile(weights_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            z.write(p, p.relative_to(adapter_dir))
    print(f"[trainer] adapter: {weights_zip.stat().st_size} bytes across {len(files)} file(s) from {adapter_dir}")
    return TrainingOutput(weights=cog.Path(str(weights_zip)))
