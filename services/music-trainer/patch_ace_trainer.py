"""Apply fail-closed AfroOne training fixes to the pinned ACE-Step v1 trainer."""

from pathlib import Path
import sys


def apply_exact_patch(source: str, old: str, new: str, label: str) -> str:
    old_count = source.count(old)
    new_count = source.count(new)
    if old_count == 1 and new_count == 0:
        return source.replace(old, new, 1)
    if old_count == 0 and new_count == 1:
        return source
    raise RuntimeError(
        f"ACE-Step patch '{label}' has invalid state "
        f"(pristine={old_count}, patched={new_count})"
    )


def write_patched_pair(
    trainer: Path,
    trainer_source: str,
    original_trainer: str,
    transformer: Path,
    transformer_source: str,
    original_transformer: str,
) -> None:
    trainer_tmp = trainer.with_name(f".{trainer.name}.afroone.tmp")
    transformer_tmp = transformer.with_name(f".{transformer.name}.afroone.tmp")
    try:
        trainer_tmp.write_text(trainer_source, encoding="utf-8")
        transformer_tmp.write_text(transformer_source, encoding="utf-8")
        trainer_tmp.replace(trainer)
        transformer_tmp.replace(transformer)
    except Exception:
        trainer.write_text(original_trainer, encoding="utf-8")
        transformer.write_text(original_transformer, encoding="utf-8")
        raise
    finally:
        trainer_tmp.unlink(missing_ok=True)
        transformer_tmp.unlink(missing_ok=True)


def patch_trainer(root: Path) -> None:
    trainer = root / "trainer.py"
    transformer = root / "acestep" / "models" / "ace_step_transformer.py"
    original_trainer = trainer.read_text(encoding="utf-8")
    original_transformer = transformer.read_text(encoding="utf-8")

    source = apply_exact_patch(
        original_trainer,
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

    source = apply_exact_patch(
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

    source = apply_exact_patch(
        source,
        """        return [optimizer], [{"scheduler": lr_scheduler, "interval": "step"}]

    def train_dataloader(self):
""",
        """        return [optimizer], [{"scheduler": lr_scheduler, "interval": "step"}]

    def on_before_optimizer_step(self, optimizer):
        if getattr(self, "_afroone_grad_verified", False):
            return
        saw_gradient = False
        saw_speaker_gradient = False
        saw_transformer_gradient = False
        for name, parameter in self.transformers.named_parameters():
            if not parameter.requires_grad or parameter.grad is None:
                continue
            if not torch.isfinite(parameter.grad).all():
                raise RuntimeError(f"AfroOne LoRA produced a non-finite gradient at {name}")
            if parameter.grad.detach().abs().max().item() > 0:
                saw_gradient = True
                if "speaker_embedder" in name:
                    saw_speaker_gradient = True
                elif "transformer_blocks." in name:
                    saw_transformer_gradient = True
        if not saw_gradient:
            raise RuntimeError(
                "AfroOne LoRA parameters received no nonzero gradient on the first step"
            )
        if not saw_speaker_gradient or not saw_transformer_gradient:
            raise RuntimeError(
                "AfroOne first step did not reach both speaker and transformer LoRA paths"
            )
        self._afroone_grad_verified = True
        print(
            "[afroone] verified finite nonzero LoRA gradients "
            "(speaker + transformer)",
            flush=True,
        )

    def train_dataloader(self):
""",
        "first-step gradient assertion",
    )

    source = apply_exact_patch(
        source,
        '        strategy="ddp_find_unused_parameters_true",\n',
        """        strategy=(
            "auto"
            if args.devices == 1 and args.num_nodes == 1
            else "ddp_find_unused_parameters_true"
        ),
""",
        "single-GPU trainer strategy",
    )

    transformer_source = apply_exact_patch(
        original_transformer,
        """                hidden_states = torch.utils.checkpoint.checkpoint(
                    block,
                    hidden_states=hidden_states,
                    attention_mask=attention_mask,
                    encoder_hidden_states=encoder_hidden_states,
                    encoder_attention_mask=encoder_hidden_mask,
                    rotary_freqs_cis=rotary_freqs_cis,
                    rotary_freqs_cis_cross=encoder_rotary_freqs_cis,
                    temb=temb,
                    use_reentrant=False,
                )
""",
        """                # The pinned non-reentrant checkpoint can replay a different
                # tensor-save order under PEFT plus autocast. Reentrant replay is
                # stable when every block dependency is an explicit input.
                def _afroone_checkpointed_block(
                    states,
                    context,
                    self_mask,
                    context_mask,
                    rotary_cos,
                    rotary_sin,
                    cross_rotary_cos,
                    cross_rotary_sin,
                    timestep_embedding,
                    checkpoint_block=block,
                ):
                    return checkpoint_block(
                        states,
                        context,
                        self_mask,
                        context_mask,
                        (rotary_cos, rotary_sin),
                        (cross_rotary_cos, cross_rotary_sin),
                        timestep_embedding,
                    )

                hidden_states = torch.utils.checkpoint.checkpoint(
                    _afroone_checkpointed_block,
                    hidden_states,
                    encoder_hidden_states,
                    attention_mask,
                    encoder_hidden_mask,
                    rotary_freqs_cis[0],
                    rotary_freqs_cis[1],
                    encoder_rotary_freqs_cis[0],
                    encoder_rotary_freqs_cis[1],
                    temb,
                    use_reentrant=True,
                )
""",
        "reentrant transformer checkpoint",
    )

    write_patched_pair(
        trainer,
        source,
        original_trainer,
        transformer,
        transformer_source,
        original_transformer,
    )
    print(f"[afroone] patched pinned ACE-Step trainer at {trainer}")
    print(f"[afroone] patched pinned ACE-Step transformer at {transformer}")


if __name__ == "__main__":
    patch_trainer(Path(sys.argv[1] if len(sys.argv) > 1 else "/src/ACE-Step"))
