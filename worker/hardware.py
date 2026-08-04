"""Device detection for the hybrid worker (Apple Silicon MPS / NVIDIA CUDA /
CPU fallback)."""

import os


def detect_device(forced: str | None = None) -> str:
    """Return the best available torch device.

    Priority: explicit override -> cuda -> mps -> cpu.
    """
    if forced:
        forced = forced.strip().lower()
        if forced in {"cuda", "mps", "cpu"}:
            return forced
        raise ValueError(f"unsupported device {forced!r} (choose 'cuda', 'mps' or 'cpu')")

    try:
        import torch
    except ImportError:
        return "cpu"

    if torch.cuda.is_available():
        return "cuda"

    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return "mps"

    return "cpu"


def device_from_env(prefix: str) -> str:
    """Read a per-model device override, e.g. GPT_SOVITS_DEVICE / LIVEPORTRAIT_DEVICE."""
    return detect_device(os.environ.get(f"{prefix}_DEVICE"))
