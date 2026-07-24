"""Apply fail-closed AfroOne training fixes to the pinned ACE-Step v1 trainer."""

from pathlib import Path
import sys


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(
            f"ACE-Step patch '{label}' expected exactly one anchor, found {count}"
        )
    return source.replace(old, new, 1)


def patch_trainer(root: Path) -> None:
    trainer = root / "trainer.py"
    source = trainer.read_text(encoding="utf-8")

    source = replace_once(
        source,
        """        noisy_image = sigmas * noise + (1.0 - sigmas) * target_image

        # This is the flow-matching target for vanilla SD3.
""",
        """        noisy_image = sigmas * noise + (1.0 - sigmas) * target_image

        # PEFT LoRA + activation checkpointing needs a graph-connected model
        # input when the base model and encoders are frozen. Without this,
        # PyTorch can detach the checkpointed forward and the first backward
        # fails with "tensor does not require grad".
        if not noisy_image.requires_grad:
            noisy_image.requires_grad_(True)

        # This is the flow-matching target for vanilla SD3.
""",
        "graph-connected latent",
    )

    source = replace_once(
        source,
        """        trainable_params = [
            p for name, p in self.transformers.named_parameters() if p.requires_grad
        ]
        optimizer = torch.optim.AdamW(
""",
        """        trainable_params = [
            p for name, p in self.transformers.named_parameters() if p.requires_grad
        ]
        if not trainable_params:
            raise RuntimeError("AfroOne LoRA injection produced zero trainable parameters")
        trainable_count = sum(p.numel() for p in trainable_params)
        print(f"[afroone] verified {trainable_count:,} trainable LoRA parameters", flush=True)
        optimizer = torch.optim.AdamW(
""",
        "trainable parameter assertion",
    )

    source = replace_once(
        source,
        """        return [optimizer], [{"scheduler": lr_scheduler, "interval": "step"}]

    def train_dataloader(self):
""",
        """        return [optimizer], [{"scheduler": lr_scheduler, "interval": "step"}]

    def on_before_optimizer_step(self, optimizer):
        if getattr(self, "_afroone_grad_verified", False):
            return
        saw_gradient = False
        for name, parameter in self.transformers.named_parameters():
            if not parameter.requires_grad or parameter.grad is None:
                continue
            if not torch.isfinite(parameter.grad).all():
                raise RuntimeError(f"AfroOne LoRA produced a non-finite gradient at {name}")
            if parameter.grad.detach().abs().max().item() > 0:
                saw_gradient = True
                break
        if not saw_gradient:
            raise RuntimeError(
                "AfroOne LoRA parameters received no nonzero gradient on the first step"
            )
        self._afroone_grad_verified = True
        print("[afroone] verified nonzero LoRA gradient", flush=True)

    def train_dataloader(self):
""",
        "first-step gradient assertion",
    )

    trainer.write_text(source, encoding="utf-8")

    verified = trainer.read_text(encoding="utf-8")
    required = (
        "noisy_image.requires_grad_(True)",
        "verified {trainable_count:,} trainable LoRA parameters",
        "verified nonzero LoRA gradient",
    )
    missing = [marker for marker in required if marker not in verified]
    if missing:
        raise RuntimeError(f"ACE-Step trainer patch verification failed: {missing}")
    print(f"[afroone] patched pinned ACE-Step trainer at {trainer}")


if __name__ == "__main__":
    patch_trainer(Path(sys.argv[1] if len(sys.argv) > 1 else "/src/ACE-Step"))
