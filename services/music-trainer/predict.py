"""AfroHit music model — serving side of the trainer image.

cog 0.9.8 requires a `predict` entry even for destination-training models, and
this one is REAL: it renders a song from tags + lyrics through the ACE-Step v1
(3.5B) pipeline, optionally with a trained AfroHit LoRA adapter loaded — i.e.
the first cut of the "render through our trained weights" path.

Heavy imports live in setup() (cog's schema validation imports this module at
push time and must stay light). The base checkpoint auto-downloads from HF on
first boot. Any pipeline-API drift fails LOUDLY at predict time — this wrapper
never fakes a render. The nightly flywheel only uses the /trainings API, so
training is unaffected either way.
"""
import cog
from cog import BasePredictor, Input
import tempfile
from pathlib import Path
from adapter_contract import extract_lora_archive, materialize_path


class Predictor(BasePredictor):
    def setup(self, weights: cog.Path = None):
        # Lazy heavy import — module import stays stdlib-only for schema gen.
        from acestep.pipeline_ace_step import ACEStepPipeline

        self.pipeline = ACEStepPipeline(None)  # None => auto-download base ckpt
        load = getattr(self.pipeline, "load_checkpoint", None)
        if callable(load):
            load(self.pipeline.checkpoint_dir)
        self.trained_lora_path = "none"
        if weights is not None:
            extracted = Path(tempfile.mkdtemp(prefix="afh-trained-lora-"))
            self.trained_lora_path = str(
                extract_lora_archive(materialize_path(weights), extracted)
            )
            print(
                f"[afroone] loaded destination fine-tune from "
                f"{self.trained_lora_path}",
                flush=True,
            )

    def predict(
        self,
        tags: str = Input(description="Comma-separated audio tags (genre, vocal type, instruments, mood, tempo, key)"),
        lyrics: str = Input(description="Lyrics with [Verse]/[Chorus] structure, or [instrumental]", default="[instrumental]"),
        duration: float = Input(description="Audio duration in seconds", default=60, ge=10, le=240),
        lora_weights_zip: cog.Path = Input(description="Optional trained AfroHit LoRA adapter zip (output of this model's training)", default=None),
        infer_steps: int = Input(description="Diffusion steps", default=60, ge=10, le=200),
        guidance_scale: float = Input(description="Guidance scale", default=15.0, ge=1.0, le=30.0),
        seed: int = Input(description="Random seed (-1 = random)", default=-1),
    ) -> cog.Path:
        lora_path = self.trained_lora_path
        if lora_weights_zip is not None:
            extracted = Path(tempfile.mkdtemp(prefix="afh-request-lora-"))
            lora_path = str(
                extract_lora_archive(
                    materialize_path(lora_weights_zip),
                    extracted,
                )
            )

        out = Path(tempfile.mkdtemp(prefix="afh-out-")) / "output.wav"
        # Param names per the v1 pipeline __call__ (README/gui + ZH_RAP_LORA.md).
        # If the repo's signature moved, this raises a loud TypeError — repin here.
        self.pipeline(
            prompt=tags,
            lyrics=lyrics,
            audio_duration=duration,
            infer_step=infer_steps,
            guidance_scale=guidance_scale,
            manual_seeds=[seed] if seed >= 0 else None,
            lora_name_or_path=lora_path,
            save_path=str(out),
        )
        if not out.exists() or out.stat().st_size < 44100:
            raise RuntimeError("pipeline returned no audio — refusing to fake a render")
        return cog.Path(str(out))
