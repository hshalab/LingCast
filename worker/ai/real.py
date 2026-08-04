"""Real-model pipeline: GPT-SoVITS (voice clone TTS) + LivePortrait (face
animation). Same InferencePipeline interface as the mock pipeline."""

import logging
import time

from .base import InferencePipeline, TaskInputs

logger = logging.getLogger(__name__)


class RealPipeline(InferencePipeline):
    def __init__(self, sleep_seconds: int = 0, tts=None, renderer=None, lipsync=None):
        # Lazy imports: heavy torch/model deps must not load in AI_MODE=mock
        # (e.g. inside the lightweight Docker worker).
        from .renderer_real import LivePortraitRenderer
        from .tts_real import GPTSoVITSTTS
        from .lipsync_real import Wav2LipLipSync

        self.sleep_seconds = sleep_seconds
        self.tts = tts or GPTSoVITSTTS()
        self.renderer = renderer or LivePortraitRenderer()
        self.lipsync = lipsync or Wav2LipLipSync()

    def run(self, inputs: TaskInputs):
        if self.sleep_seconds:
            logger.info("real pipeline: sleeping %s seconds", self.sleep_seconds)
            time.sleep(self.sleep_seconds)

        tts_wav = self.tts.synthesize(
            inputs.script_text,
            inputs.audio_path,
            inputs.work_dir / "tts_out.wav",
        )
        base_video = self.renderer.render(inputs.image_path, tts_wav, inputs.work_dir)
        final = self.lipsync.sync(tts_wav, base_video, inputs.work_dir)
        logger.info("real pipeline rendered %s", final)
        return final
