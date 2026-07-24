"""Compatibility loaded automatically before ACE-Step under Cog's Torch 2.3."""
import torch
from torch import nn


if not hasattr(nn, "RMSNorm"):
    class RMSNorm(nn.Module):
        """PyTorch-compatible RMSNorm for the Cog 0.9.8 Torch matrix."""

        def __init__(
            self,
            normalized_shape,
            eps=None,
            elementwise_affine=True,
            device=None,
            dtype=None,
        ):
            super().__init__()
            if isinstance(normalized_shape, int):
                normalized_shape = (normalized_shape,)
            self.normalized_shape = tuple(normalized_shape)
            self.eps = (
                torch.finfo(dtype or torch.get_default_dtype()).eps
                if eps is None
                else eps
            )
            if elementwise_affine:
                self.weight = nn.Parameter(
                    torch.ones(
                        self.normalized_shape,
                        device=device,
                        dtype=dtype,
                    )
                )
            else:
                self.register_parameter("weight", None)

        def forward(self, value):
            dims = tuple(range(-len(self.normalized_shape), 0))
            normalized = value * torch.rsqrt(
                value.pow(2).mean(dim=dims, keepdim=True) + self.eps
            )
            return normalized if self.weight is None else normalized * self.weight

        def extra_repr(self):
            return (
                f"{self.normalized_shape}, eps={self.eps}, "
                f"elementwise_affine={self.weight is not None}"
            )

    nn.RMSNorm = RMSNorm
