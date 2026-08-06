"""Shared helpers for the ONNX-based lip-sync stage.

Both the Wav2Lip generator and the SCRFD face detector are exported to ONNX,
so the whole lip-sync stage runs without torch. On Apple Silicon we prefer the
CoreML execution provider (uses the Neural Engine / GPU and keeps CPU usage
low), falling back to the CPU provider automatically.
"""

import logging
import os
from pathlib import Path

import onnxruntime

logger = logging.getLogger(__name__)

DEFAULT_THREADS = 4


def build_session(
    model_path: Path,
    allow_coreml: bool = True,
    threads_env: str = "WAV2LIP_THREADS",
    provider_env: str = "WAV2LIP_PROVIDER",
) -> onnxruntime.InferenceSession:
    """Create an ONNX Runtime session with bounded CPU threads.

    Provider order: CoreML (macOS) -> CPU. Threads are capped so a single task
    never saturates every CPU core (the worker may run other stages/agents).
    `threads_env` / `provider_env` allow other stages (e.g. face restoration)
    to use their own knobs instead of sharing the Wav2Lip ones.
    """
    threads = int(os.environ.get(threads_env, str(DEFAULT_THREADS)))
    options = onnxruntime.SessionOptions()
    options.graph_optimization_level = onnxruntime.GraphOptimizationLevel.ORT_ENABLE_ALL
    options.intra_op_num_threads = max(1, threads)

    override = os.environ.get(provider_env, "").strip().lower()
    if override:
        providers = {
            "coreml": ["CoreMLExecutionProvider", "CPUExecutionProvider"],
            "cpu": ["CPUExecutionProvider"],
            "cuda": ["CUDAExecutionProvider", "CPUExecutionProvider"],
            "rocm": ["ROCMExecutionProvider", "CPUExecutionProvider"],
        }.get(override)
        if providers is None:
            logger.warning("unknown %s=%r, falling back to auto", provider_env, override)

    if not override or providers is None:
        available = onnxruntime.get_available_providers()
        if allow_coreml and "CoreMLExecutionProvider" in available:
            providers = ["CoreMLExecutionProvider", "CPUExecutionProvider"]
        elif "ROCMExecutionProvider" in available:
            providers = ["ROCMExecutionProvider", "CPUExecutionProvider"]
        elif "CUDAExecutionProvider" in available:
            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        else:
            providers = ["CPUExecutionProvider"]

    session = onnxruntime.InferenceSession(
        str(model_path), sess_options=options, providers=providers
    )
    logger.debug(
        "onnx session for %s using %s", Path(model_path).name, session.get_providers()
    )
    return session
