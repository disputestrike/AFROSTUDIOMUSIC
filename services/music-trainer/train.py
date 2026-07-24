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
  5. harvest the Diffusers PEFT adapter (pytorch_lora_weights.safetensors)
     from {logger_dir}/.../checkpoints/*_lora/, zip it, return it

HONESTY: every step runs the real ACE-Step v1 code. Empty dataset, thin corpus,
a nonzero trainer exit, or a run that produced no adapter each raise LOUDLY —
this wrapper NEVER fakes a training success or ships an empty adapter.
"""
import cog
from cog import BaseModel, Input
import math
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from patch_ace_trainer import patch_trainer
from adapter_contract import (
    LORA_WEIGHT_NAME,
    MAX_DATASET_MEMBERS,
    MAX_DATASET_UNCOMPRESSED_BYTES,
    extract_zip_archive,
    find_lora_directory,
    materialize_path,
    validate_lora_config,
)


class TrainingOutput(BaseModel):
    weights: cog.Path


AUDIO_EXTS = {".wav", ".mp3", ".flac", ".ogg", ".opus", ".m4a"}
ACE = Path("/src/ACE-Step")
MIN_VOCAL_SEGMENTS = 3
MIN_VOCAL_ACTIVE_SECONDS = 10.0


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
    if duration < 2:
        print(f"[trainer] skipping unusably short clip ({duration:.1f}s): {src.name}", file=sys.stderr)
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

    short_clip = duration < 25
    n_segs = 1 if short_clip else max(
        1, int(duration // max_seg_s) + (1 if duration % max_seg_s >= 30 else 0)
    )
    written = 0
    for s in range(n_segs):
        key = f"track{index:03d}_{s:02d}"
        mp3 = data_dir / f"{key}.mp3"
        if short_clip and "loop-instrument-adapter" in prompt.lower():
            # Repeat rights-cleared loops to ACE-Step's 30-second floor while
            # preserving exact tempo and phase.
            cmd = [
                "ffmpeg", "-v", "error", "-y", "-stream_loop", "-1",
                "-i", str(src), "-t", "30", "-ar", "44100", "-ac", "2",
                "-b:a", "320k", str(mp3),
            ]
        elif short_clip:
            # Keep short isolated vocals/takes without creating a fake repeated
            # phrase. Silence-pad the tail to the trainer's duration floor.
            cmd = [
                "ffmpeg", "-v", "error", "-y", "-i", str(src),
                "-af", "apad=pad_dur=30", "-t", "30", "-ar", "44100",
                "-ac", "2", "-b:a", "320k", str(mp3),
            ]
        else:
            cmd = [
                "ffmpeg", "-v", "error", "-y", "-ss", str(s * max_seg_s),
                "-t", str(max_seg_s), "-i", str(src), "-ar", "44100",
                "-ac", "2", "-b:a", "320k", str(mp3),
            ]
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


def _max_volume_db(audio_path: Path) -> float | None:
    """Return ffmpeg's measured peak volume, or None for unreadable audio."""
    probe = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "info",
            "-i",
            str(audio_path),
            "-af",
            "volumedetect",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
    )
    matches = re.findall(
        r"max_volume:\s*(-?(?:inf|\d+(?:\.\d+)?))\s*dB",
        probe.stderr,
        flags=re.IGNORECASE,
    )
    if probe.returncode != 0 or not matches:
        return None
    if matches[-1].lower() == "-inf":
        return float("-inf")
    return float(matches[-1])


def _active_audio_seconds(audio_path: Path) -> float | None:
    """Estimate active signal duration using ffmpeg's silence detector."""
    duration_probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(audio_path),
        ],
        capture_output=True,
        text=True,
    )
    try:
        duration = float(duration_probe.stdout.strip())
    except ValueError:
        return None
    silence_probe = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "info",
            "-i",
            str(audio_path),
            "-af",
            "silencedetect=noise=-45dB:d=0.3",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
    )
    if silence_probe.returncode != 0:
        return None
    silence_durations = [
        float(value)
        for value in re.findall(
            r"silence_duration:\s*(\d+(?:\.\d+)?)",
            silence_probe.stderr,
        )
    ]
    return max(0.0, duration - sum(silence_durations))


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

    # 1. unzip within explicit resource limits
    extract_zip_archive(
        materialize_path(dataset_zip),
        raw,
        max_members=MAX_DATASET_MEMBERS,
        max_uncompressed_bytes=MAX_DATASET_UNCOMPRESSED_BYTES,
    )
    audio = sorted(p for p in raw.rglob("*") if p.suffix.lower() in AUDIO_EXTS)
    if not audio:
        raise RuntimeError("dataset_zip contained no audio files — refusing to fake a training run")
    print(f"[trainer] {len(audio)} source audio file(s)")

    # 2. conform into the strict v1 layout (<key>.mp3 + _prompt.txt + _lyrics.txt)
    kept = sum(_conform(src, data, i) for i, src in enumerate(audio))
    if kept < 3:
        raise RuntimeError(f"only {kept} usable 30s+ segments after conforming — corpus too thin to train honestly")
    print(f"[trainer] {kept} conformed segment(s) ready")
    vocal_rows: list[tuple[Path, float]] = []
    for prompt_path in data.glob("*_prompt.txt"):
        if "voice-singing-model" not in prompt_path.read_text(
            encoding="utf-8", errors="ignore"
        ).lower():
            continue
        lyrics_path = prompt_path.with_name(
            prompt_path.name.replace("_prompt.txt", "_lyrics.txt")
        )
        if lyrics_path.read_text(
            encoding="utf-8", errors="ignore"
        ).strip().lower() in {"", "[instrumental]"}:
            continue
        audio_path = prompt_path.with_name(
            prompt_path.name.replace("_prompt.txt", ".mp3")
        )
        max_volume = _max_volume_db(audio_path)
        active_seconds = _active_audio_seconds(audio_path)
        if (
            max_volume is not None
            and max_volume > -45
            and active_seconds is not None
            and active_seconds >= 1.5
        ):
            vocal_rows.append((prompt_path, active_seconds))
    total_vocal_seconds = sum(active_seconds for _, active_seconds in vocal_rows)
    if (
        len(vocal_rows) < MIN_VOCAL_SEGMENTS
        or total_vocal_seconds < MIN_VOCAL_ACTIVE_SECONDS
    ):
        raise RuntimeError(
            "corpus requires at least "
            f"{MIN_VOCAL_SEGMENTS} audible rights-cleared voice-singing-model "
            f"rows and {MIN_VOCAL_ACTIVE_SECONDS:.0f}s active signal; found "
            f"{len(vocal_rows)} rows and {total_vocal_seconds:.1f}s"
        )
    print(
        f"[trainer] accepted {len(vocal_rows)} audible, metadata-declared "
        f"isolated-vocal segment(s) with {total_vocal_seconds:.1f}s active "
        "signal and lyric conditioning",
        flush=True,
    )

    # 3. convert to the HuggingFace dataset the trainer consumes
    repeat = repeat_count or max(1, min(2000, round(2000 / kept)))
    _run([sys.executable, str(ACE / "convert2hf_dataset.py"),
          "--data_dir", str(data), "--repeat_count", str(repeat), "--output_name", str(hf)],
         "convert2hf_dataset")
    if not any(hf.rglob("*.arrow")):
        raise RuntimeError("convert2hf_dataset produced no dataset arrow — aborting before a hollow train")

    # 4. train LoRA (base ACE-Step-v1-3.5B + MERT/mHuBERT auto-download from HF at runtime)
    # Cog copies repository source after build.run, so apply the pinned,
    # fail-closed upstream patch here when every runtime file is present.
    patch_trainer(ACE)
    cfg = Path(__file__).with_name("afroone_lora_config.json")
    if not cfg.exists():
        raise RuntimeError(f"missing AfroOne LoRA config {cfg}")
    validate_lora_config(cfg)
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

    # 5. Harvest the exact Diffusers adapter filename ACE-Step writes and reads.
    final_adapters = sorted(
        adapter
        for adapter in out.rglob(LORA_WEIGHT_NAME)
        if adapter.parent.name.startswith("final-step=")
    )
    if len(final_adapters) != 1:
        raise RuntimeError(
            "trainer must write exactly one final-step AfroOne adapter; found "
            f"{len(final_adapters)} {LORA_WEIGHT_NAME} file(s)"
        )
    adapter_dir = final_adapters[0].parent
    find_lora_directory(adapter_dir)
    files = [p for p in adapter_dir.rglob("*") if p.is_file()]
    weights_zip = work / "weights.zip"
    with zipfile.ZipFile(weights_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            z.write(p, p.relative_to(adapter_dir))
    print(f"[trainer] adapter: {weights_zip.stat().st_size} bytes across {len(files)} file(s) from {adapter_dir}")
    return TrainingOutput(weights=cog.Path(str(weights_zip)))
