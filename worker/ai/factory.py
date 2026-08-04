from .base import InferencePipeline


def create_pipeline(mode: str, **kwargs) -> InferencePipeline:
    """Instantiate the pipeline selected by the AI_MODE environment variable.

    - mock: espeak-ng TTS + ffmpeg composite (lightweight, Docker-safe).
    - real: GPT-SoVITS voice-clone TTS + LivePortrait face animation.

    Real-model modules are imported lazily so AI_MODE=mock never pulls in
    torch or the model repos.
    """
    mode = (mode or "mock").strip().lower()
    if mode == "mock":
        from .mock import MockPipeline

        return MockPipeline(**kwargs)
    if mode == "real":
        from .real import RealPipeline

        return RealPipeline(**kwargs)
    raise ValueError(f"unknown AI_MODE {mode!r}; available modes: mock, real")
