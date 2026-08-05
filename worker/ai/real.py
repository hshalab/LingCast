"""Offline broadcast pipeline: Edge-TTS + Wav2Lip over a pre-processed base video.

LivePortrait is intentionally NOT part of this pipeline anymore: the avatar's
silent base driving video is generated once at asset-preprocessing time and
stored in S3 (see process_avatar_asset in worker.py). Wav2Lip loops the base
clip internally so any script length can be covered. TTS defaults to Edge-TTS
(GPU-free); set TTS_ENGINE=gpt-sovits to use the legacy voice-clone model.
"""

import logging
import os
import time

from .base import InferencePipeline, TaskInputs

logger = logging.getLogger(__name__)


class RealPipeline(InferencePipeline):
    def __init__(self, sleep_seconds: int = 0, tts=None, lipsync=None):
        # Lazy imports: heavy torch/model deps must not load in AI_MODE=mock
        # (e.g. inside the lightweight Docker worker).
        from .lipsync_onnx import Wav2LipOnnxLipSync

        self.sleep_seconds = sleep_seconds
        self.tts = tts
        backend = os.environ.get("WAV2LIP_BACKEND", "onnx").strip().lower()
        if backend == "torch":
            from .lipsync_real import Wav2LipLipSync

            self.lipsync = lipsync or Wav2LipLipSync()
            logger.warning("WAV2LIP_BACKEND=torch is slow on Apple Silicon; ONNX is the default")
        else:
            self.lipsync = lipsync or Wav2LipOnnxLipSync()

    def run(self, inputs: TaskInputs):
        if inputs.base_video_path is None or not inputs.base_video_path.exists():
            raise RuntimeError(
                "base driving video missing: run the avatar pre-processing step "
                "(or wait for the worker to finish generating it) before creating a task"
            )
        if self.sleep_seconds:
            logger.info("real pipeline: sleeping %s seconds", self.sleep_seconds)
            time.sleep(self.sleep_seconds)

        tts = self._build_tts(inputs)
        tts_wav = tts.synthesize(
            inputs.script_text,
            None,
            inputs.work_dir / "tts_out.wav",
        )
        final = self.lipsync.sync(tts_wav, inputs.base_video_path, inputs.work_dir)
        logger.info("real pipeline rendered %s", final)
        return final

    def _build_tts(self, inputs: TaskInputs):
        engine = os.environ.get("TTS_ENGINE", "edge").strip().lower()
        if engine == "gpt-sovits":
            if self.tts is None:
                from .tts_real import GPTSoVITSTTS

                self.tts = GPTSoVITSTTS()
            return self.tts
        from .tts_edge import EdgeTTS

        return EdgeTTS(voice_id=inputs.voice_id)
