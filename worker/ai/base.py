from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path


@dataclass
class TaskInputs:
    """Material and context for one synthesis task, already on local disk."""

    task_id: int
    avatar_id: int
    script_text: str
    image_path: Path
    work_dir: Path
    audio_path: Path | None = None
    base_video_path: Path | None = None
    voice_id: str = ""


class InferencePipeline(ABC):
    """Contract for an AI pipeline. Implementations receive local files and
    must return the path of the rendered MP4."""

    @abstractmethod
    def run(self, inputs: TaskInputs) -> Path:
        """Run inference and return the output MP4 path."""


class Renderer(ABC):
    """Contract for the face-animation step: image + synthesized speech -> MP4."""

    @abstractmethod
    def render(self, image_path: Path, tts_wav: Path, work_dir: Path) -> Path:
        """Render the final talking-avatar MP4."""
