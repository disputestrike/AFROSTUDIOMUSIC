"""Shared AfroOne LoRA archive and configuration contract."""

from __future__ import annotations

import json
import zipfile
from pathlib import Path


LORA_WEIGHT_NAME = "pytorch_lora_weights.safetensors"
REQUIRED_TARGETS = {
    "linear_q",
    "linear_k",
    "linear_v",
    "to_q",
    "to_k",
    "to_v",
    "to_out.0",
}


def materialize_path(value) -> Path:
    """Resolve Cog 0.9.8's lazy URLPath before using it as a local file."""
    convert = getattr(value, "convert", None)
    if callable(convert):
        value = convert()
    return Path(value)


def validate_lora_config(path: Path) -> dict:
    config = json.loads(path.read_text(encoding="utf-8"))
    targets = set(config.get("target_modules") or [])
    if targets != REQUIRED_TARGETS:
        raise RuntimeError(
            "AfroOne LoRA targets must cover the lyric encoder and music "
            f"transformer exactly; got {sorted(targets)}"
        )
    if "speaker_embedder" in targets:
        raise RuntimeError(
            "speaker_embedder is unsupported by the released ACE-Step v1 "
            "checkpoint and must not be trained"
        )
    rank = config.get("r")
    alpha = config.get("lora_alpha")
    if rank != alpha or not isinstance(rank, int) or rank <= 0:
        raise RuntimeError(
            "AfroOne requires equal positive integer r/lora_alpha so the "
            "saved adapter's inferred serving scale matches training"
        )
    if config.get("use_rslora", False):
        raise RuntimeError(
            "AfroOne adapters must use standard LoRA because ACE-Step's "
            "released adapter artifact does not preserve rsLoRA metadata"
        )
    return config


def find_lora_directory(root: Path) -> Path:
    weights = sorted(root.rglob(LORA_WEIGHT_NAME))
    if len(weights) != 1:
        raise RuntimeError(
            f"expected exactly one {LORA_WEIGHT_NAME}, found {len(weights)}"
        )
    if weights[0].stat().st_size < 1024:
        raise RuntimeError("AfroOne LoRA weights file is empty or truncated")
    return weights[0].parent


def extract_lora_archive(archive: Path, destination: Path) -> Path:
    if archive.is_dir():
        return find_lora_directory(archive)
    if not archive.is_file():
        raise RuntimeError(f"AfroOne LoRA archive does not exist: {archive}")

    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            target = (destination / member.filename).resolve()
            if root != target and root not in target.parents:
                raise RuntimeError(
                    f"AfroOne LoRA archive contains an unsafe path: {member.filename}"
                )
        bundle.extractall(destination)
    return find_lora_directory(destination)
