from .base import InferencePipeline
from .mock import MockPipeline


_PIPELINES = {
    "mock": MockPipeline,
}


def create_pipeline(mode: str, **kwargs) -> InferencePipeline:
    """Instantiate the pipeline selected by the AI_MODE environment variable.

    Example for later: register {"liveportrait": LivePortraitPipeline} and set
    AI_MODE=liveportrait -- no orchestration changes required.
    """
    if mode not in _PIPELINES:
        raise ValueError(
            f"unknown AI_MODE {mode!r}; available modes: {sorted(_PIPELINES)}"
        )
    return _PIPELINES[mode](**kwargs)
