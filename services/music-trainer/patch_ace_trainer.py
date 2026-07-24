"""Apply fail-closed AfroOne training fixes to the pinned ACE-Step v1 trainer."""

from pathlib import Path
import sys


def apply_exact_patch(source: str, old: str, new: str, label: str) -> str:
    old_count = source.count(old)
    new_count = source.count(new)
    if old_count == 1 and new_count == 0:
        return source.replace(old, new, 1)
    if new_count == 1 and old_count in {0, 1}:
        return source
    raise RuntimeError(
        f"ACE-Step patch '{label}' has invalid state "
        f"(pristine={old_count}, patched={new_count})"
    )


def write_patched_files(files: list[tuple[Path, str, str]]) -> None:
    temporary_files = [
        path.with_name(f".{path.name}.afroone.tmp")
        for path, _, _ in files
    ]
    try:
        for temporary, (_, patched, _) in zip(temporary_files, files):
            temporary.write_text(patched, encoding="utf-8")
        for temporary, (path, _, _) in zip(temporary_files, files):
            temporary.replace(path)
    except Exception:
        for path, _, original in files:
            path.write_text(original, encoding="utf-8")
        raise
    finally:
        for temporary in temporary_files:
            temporary.unlink(missing_ok=True)


def patch_trainer(root: Path) -> None:
    trainer = root / "trainer.py"
    transformer = root / "acestep" / "models" / "ace_step_transformer.py"
    dataset = root / "acestep" / "text2music_dataset.py"
    original_trainer = trainer.read_text(encoding="utf-8")
    original_transformer = transformer.read_text(encoding="utf-8")
    original_dataset = dataset.read_text(encoding="utf-8")

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
        """            lyric_mask = torch.where(
                full_cfg_condition_mask.unsqueeze(1).bool(),
                lyric_mask,
                torch.zeros_like(lyric_mask),
            )

        return (
""",
        """            lyric_mask = torch.where(
                full_cfg_condition_mask.unsqueeze(1).bool(),
                lyric_mask,
                torch.zeros_like(lyric_mask),
            )

            # Dedicated vocal rows must always exercise the lyric-conditioning
            # path; the base trainer's random CFG dropout makes proof probabilistic.
            afroone_vocal_rows = batch["afroone_vocal_conditions"].to(
                device=device,
                dtype=torch.bool,
            )
            lyric_token_ids = torch.where(
                afroone_vocal_rows.unsqueeze(1),
                batch["lyric_token_ids"],
                lyric_token_ids,
            )
            lyric_mask = torch.where(
                afroone_vocal_rows.unsqueeze(1),
                batch["lyric_masks"],
                lyric_mask,
            )

        return (
""",
        "deterministic vocal lyric conditioning",
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
        saw_transformer_gradient = False
        saw_lyric_gradient = False
        for name, parameter in self.transformers.named_parameters():
            if not parameter.requires_grad or parameter.grad is None:
                continue
            if not torch.isfinite(parameter.grad).all():
                raise RuntimeError(f"AfroOne LoRA produced a non-finite gradient at {name}")
            if parameter.grad.detach().abs().max().item() > 0:
                if "transformer_blocks." in name:
                    saw_transformer_gradient = True
                elif "lyric_encoder." in name:
                    saw_lyric_gradient = True
        if not saw_transformer_gradient:
            raise RuntimeError(
                "AfroOne first step did not reach transformer-block LoRA parameters"
            )
        if not getattr(self, "_afroone_current_vocal_condition", False):
            raise RuntimeError(
                "AfroOne first step was not a verified vocal-conditioned batch"
            )
        if not saw_lyric_gradient:
            raise RuntimeError(
                "AfroOne vocal-conditioned first step did not reach "
                "lyric-encoder LoRA parameters"
            )
        self._afroone_grad_verified = True
        print(
            "[afroone] verified finite nonzero vocal-conditioned LoRA "
            "gradients (lyric encoder + music transformer)",
            flush=True,
        )

    def train_dataloader(self):
""",
        "first-step gradient assertion",
    )

    source = apply_exact_patch(
        source,
        """        return DataLoader(
            self.train_dataset,
            shuffle=True,
            num_workers=self.hparams.num_workers,
            pin_memory=True,
            collate_fn=self.train_dataset.collate_fn,
        )
""",
        """        tags = self.train_dataset.pretrain_ds["tags"]
        vocal_indices = [
            index
            for index, row_tags in enumerate(tags)
            if "voice-singing-model" in " ".join(row_tags).lower()
        ]
        if not vocal_indices:
            raise RuntimeError(
                "AfroOne training dataset has no voice-singing-model row"
            )
        generator = torch.Generator().manual_seed(0)
        indices = torch.randperm(len(self.train_dataset), generator=generator).tolist()
        first_vocal = vocal_indices[0]
        indices.remove(first_vocal)
        indices.insert(0, first_vocal)
        return DataLoader(
            self.train_dataset,
            sampler=indices,
            num_workers=self.hparams.num_workers,
            pin_memory=True,
            collate_fn=self.train_dataset.collate_fn,
        )
""",
        "deterministic vocal-first sampler",
    )

    source = apply_exact_patch(
        source,
        """        ) = self.preprocess(batch)

        target_image = target_latents
""",
        """        ) = self.preprocess(batch)
        self._afroone_current_vocal_condition = (
            torch.any(batch["afroone_vocal_conditions"]).item()
            and torch.count_nonzero(lyric_mask).item() > 0
        )

        target_image = target_latents
""",
        "vocal-conditioned batch evidence",
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

    source = apply_exact_patch(
        source,
        """    trainer.fit(
        model,
        ckpt_path=args.ckpt_path,
    )


if __name__ == "__main__":
""",
        """    trainer.fit(
        model,
        ckpt_path=args.ckpt_path,
    )
    final_checkpoint_dir = os.path.join(
        logger_callback.log_dir,
        "checkpoints",
        f"final-step={trainer.global_step}_lora",
    )
    os.makedirs(final_checkpoint_dir, exist_ok=True)
    model.transformers.save_lora_adapter(
        final_checkpoint_dir,
        adapter_name=model.adapter_name,
    )
    print(
        f"[afroone] saved exact final-step adapter at {final_checkpoint_dir}",
        flush=True,
    )


if __name__ == "__main__":
""",
        "exact final-step adapter",
    )

    source = apply_exact_patch(
        source,
        "            or torch.distributed.get_rank() != 0\n",
        """            or (
                torch.distributed.is_initialized()
                and torch.distributed.get_rank() != 0
            )
""",
        "single-GPU plot rank guard",
    )

    dataset_source = apply_exact_patch(
        original_dataset,
        """            "structured_tags": [],
            "prompts": [],
            "speaker_embs": [],
""",
        """            "structured_tags": [],
            "prompts": [],
            "afroone_vocal_conditions": [],
            "speaker_embs": [],
""",
        "stable vocal condition batch field",
    )

    dataset_source = apply_exact_patch(
        dataset_source,
        """        # Process prompt/tags
        prompt = item["tags"]
""",
        """        # Preserve vocal identity before tags are shuffled and the
        # display prompt is truncated.
        afroone_vocal_condition = any(
            "voice-singing-model" in tag.lower()
            for tag in item["tags"]
        )

        # Process prompt/tags
        prompt = item["tags"]
""",
        "stable vocal identity",
    )

    dataset_source = apply_exact_patch(
        dataset_source,
        """            "prompt": prompt,
            "speaker_emb": speaker_emb,
""",
        """            "prompt": prompt,
            "afroone_vocal_condition": afroone_vocal_condition,
            "speaker_emb": speaker_emb,
""",
        "stable vocal identity feature",
    )

    dataset_source = apply_exact_patch(
        dataset_source,
        """            elif k in ["wav_lengths"]:
                # Convert to LongTensor
                padded_input_list = torch.LongTensor(v)
""",
        """            elif k in ["afroone_vocal_conditions"]:
                padded_input_list = torch.tensor(v, dtype=torch.bool)
            elif k in ["wav_lengths"]:
                # Convert to LongTensor
                padded_input_list = torch.LongTensor(v)
""",
        "stable vocal identity collation",
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

    transformer_source = apply_exact_patch(
        transformer_source,
        "            if self.training and self.gradient_checkpointing:\n",
        """            if (
                self.training
                and self.gradient_checkpointing
                and torch.is_grad_enabled()
            ):
""",
        "gradient-only transformer checkpoint",
    )

    write_patched_files(
        [
            (trainer, source, original_trainer),
            (transformer, transformer_source, original_transformer),
            (dataset, dataset_source, original_dataset),
        ]
    )
    print(f"[afroone] patched pinned ACE-Step trainer at {trainer}")
    print(f"[afroone] patched pinned ACE-Step transformer at {transformer}")
    print(f"[afroone] patched pinned ACE-Step dataset at {dataset}")


if __name__ == "__main__":
    patch_trainer(Path(sys.argv[1] if len(sys.argv) > 1 else "/src/ACE-Step"))
