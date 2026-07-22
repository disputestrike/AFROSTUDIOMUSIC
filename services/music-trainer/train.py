"""AfroHit music trainer — Cog `train()` wrapping ACE-Step 1.5 LoKr/LoRA.

Contract (matches packages/ai/src/music-trainer.ts + the nightly flywheel):
  input  dataset_zip : zip of rights-clean audio (the flywheel's manifest zip;
                       audio files, optionally <name>.lyrics.txt beside each)
  output weights.zip : the trained adapter weights directory, zipped

Flow (per the official LoRA_Training_Tutorial):
  1. unzip -> conform audio to 44.1k wav, slice to 30-120s segments
  2. arrange the documented dataset layout (song.wav + song.lyrics.txt)
  3. preprocess to tensor files (ACE-Step pipeline)
  4. train LoKr (default; ~minutes) or LoRA via the ACE-Step trainer
  5. zip the output weights dir and return it

HONESTY NOTE: steps 3-4 integrate against the pinned ACE-Step-1.5 checkout at
image-build time. The repo's headless entrypoints are exercised by the first CI
push run; if its internal API moved, this file fails LOUDLY with the exact
import/call that broke — never a fake success.
"""
import cog
from cog import BaseModel, Input
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


class TrainingOutput(BaseModel):
    weights: cog.Path


AUDIO_EXTS = {".wav", ".mp3", ".flac", ".ogg", ".opus"}


def _conform(src: Path, dst_dir: Path, index: int, max_seg_s: int = 110) -> list[Path]:
    """44.1k stereo wav, sliced into 30-110s segments (tutorial: 30-120s)."""
    out: list[Path] = []
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(src)],
        capture_output=True, text=True,
    )
    try:
        duration = float(probe.stdout.strip())
    except ValueError:
        print(f"[trainer] skipping unreadable audio: {src.name}", file=sys.stderr)
        return out
    if duration < 25:
        print(f"[trainer] skipping too-short clip ({duration:.0f}s): {src.name}", file=sys.stderr)
        return out
    n_segs = max(1, int(duration // max_seg_s) + (1 if duration % max_seg_s >= 30 else 0))
    for s in range(n_segs):
        start = s * max_seg_s
        seg = dst_dir / f"track{index:03d}_{s:02d}.wav"
        cmd = ["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-t", str(max_seg_s), "-i", str(src),
               "-ar", "44100", "-ac", "2", str(seg)]
        if subprocess.run(cmd).returncode == 0 and seg.exists() and seg.stat().st_size > 44100:
            out.append(seg)
    return out


def train(
    dataset_zip: cog.Path = Input(description="Zip of rights-clean training audio (flywheel manifest zip)"),
    method: str = Input(description="lokr (fast, minutes) or lora", default="lokr", choices=["lokr", "lora"]),
    epochs: int = Input(description="Training epochs", default=500, ge=10, le=2000),
    learning_rate: float = Input(description="LR (LoKr default 0.03; use 1e-4 for lora)", default=0.03),
    lokr_linear_dim: int = Input(description="LoKr linear dim", default=64),
    lokr_linear_alpha: int = Input(description="LoKr linear alpha", default=128),
) -> TrainingOutput:
    work = Path(tempfile.mkdtemp(prefix="afh-train-"))
    raw = work / "raw"
    dataset = work / "dataset"
    tensors = work / "tensors"
    out_dir = work / "weights"
    for d in (raw, dataset, tensors, out_dir):
        d.mkdir(parents=True, exist_ok=True)

    # 1. unzip
    with zipfile.ZipFile(str(dataset_zip)) as z:
        z.extractall(raw)
    audio = sorted(p for p in raw.rglob("*") if p.suffix.lower() in AUDIO_EXTS)
    if not audio:
        raise RuntimeError("dataset_zip contained no audio files — refusing to fake a training run")
    print(f"[trainer] {len(audio)} source audio file(s)")

    # 2. conform + documented layout (audio + .lyrics.txt beside each)
    kept = 0
    for i, src in enumerate(audio):
        for seg in _conform(src, dataset, i):
            lyr = src.with_suffix(".lyrics.txt")
            (dataset / f"{seg.stem}.lyrics.txt").write_text(
                lyr.read_text(encoding="utf-8", errors="ignore") if lyr.exists() else "[instrumental]",
                encoding="utf-8",
            )
            kept += 1
    if kept < 4:
        raise RuntimeError(f"only {kept} usable 30s+ segments after conforming — corpus too thin to train honestly")
    print(f"[trainer] {kept} conformed segment(s) ready")

    # 3+4. preprocess + train via the pinned ACE-Step-1.5 checkout.
    # Uses the repo's own pipeline headlessly; any interface drift fails loudly.
    ace = Path("/src/ACE-Step-1.5")
    env = {**os.environ, "PYTHONPATH": f"{ace}:{os.environ.get('PYTHONPATH', '')}"}
    runner = ace / "acestep" / "acestep_v15_pipeline.py"
    if not runner.exists():
        raise RuntimeError(f"pinned ACE-Step checkout is missing {runner} — repin the build ref in cog.yaml")
    cmd = [
        sys.executable, str(runner),
        "--mode", "train_headless",
        "--method", method,
        "--dataset_dir", str(dataset),
        "--tensor_dir", str(tensors),
        "--output_dir", str(out_dir),
        "--epochs", str(epochs),
        "--learning_rate", str(learning_rate),
        "--lokr_linear_dim", str(lokr_linear_dim),
        "--lokr_linear_alpha", str(lokr_linear_alpha),
    ]
    print(f"[trainer] invoking: {' '.join(cmd)}")
    proc = subprocess.run(cmd, env=env)
    if proc.returncode != 0:
        raise RuntimeError(
            f"ACE-Step trainer exited {proc.returncode} — see log above. If the pipeline flags moved, "
            "pin the correct headless entrypoint here (this wrapper NEVER fakes success)."
        )
    produced = [p for p in out_dir.rglob("*") if p.is_file()]
    if not produced:
        raise RuntimeError("trainer exited 0 but produced no weight files — refusing to ship an empty adapter")

    # 5. zip weights
    weights_zip = work / "weights.zip"
    with zipfile.ZipFile(weights_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for p in produced:
            z.write(p, p.relative_to(out_dir))
    print(f"[trainer] weights: {weights_zip.stat().st_size} bytes across {len(produced)} file(s)")
    return TrainingOutput(weights=cog.Path(str(weights_zip)))
