import logging
import time

from .base import InferencePipeline, TaskInputs
from .renderer import MockRenderer
from .tts import MockTTS

logger = logging.getLogger(__name__)


class MockPipeline(InferencePipeline):
    """Dummy AI pipeline used while the real TTS/face-driving models are not
    integrated yet: sleeps, then renders a short MP4 with ffmpeg.

    Swap this out by registering a real pipeline in factory.create_pipeline;
    the orchestration around it (S3 download/upload, Redis, callback) stays
    untouched.
    """

    def __init__(self, sleep_seconds: int = 10, tts=None, renderer=None):
        self.sleep_seconds = sleep_seconds
        self.tts = tts or MockTTS()
        self.renderer = renderer or MockRenderer()

    def run(self, inputs: TaskInputs):
        logger.info("mock inference: sleeping %s seconds", self.sleep_seconds)
        time.sleep(self.sleep_seconds)

        tts_wav = self.tts.synthesize(
            inputs.script_text,
            inputs.audio_path,
            inputs.work_dir / "tts_out.wav",
        )

        output = self.renderer.render(inputs.image_path, tts_wav, inputs.work_dir)
        logger.info("mock inference rendered %s", output)
        return output
