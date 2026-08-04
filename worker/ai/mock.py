import logging
import subprocess
import time

from .base import InferencePipeline, TaskInputs
from .tts import MockTTS

logger = logging.getLogger(__name__)


class MockPipeline(InferencePipeline):
    """Dummy AI pipeline used while the real TTS/face-driving models are not
    integrated yet: sleeps, then renders a short MP4 with ffmpeg.

    Swap this out by registering a real pipeline in factory.create_pipeline;
    the orchestration around it (S3 download/upload, Redis, callback) stays
    untouched.
    """

    def __init__(self, sleep_seconds: int = 10, tts=None):
        self.sleep_seconds = sleep_seconds
        self.tts = tts or MockTTS()

    def run(self, inputs: TaskInputs):
        logger.info("mock inference: sleeping %s seconds", self.sleep_seconds)
        time.sleep(self.sleep_seconds)

        # Voice-clone step: synthesize the script text. The uploaded audio is
        # the reference timbre; the mock renders the script with an offline
        # TTS engine so the video contains speech, not the reference itself.
        tts_wav = self.tts.synthesize(
            inputs.script_text,
            inputs.audio_path,
            inputs.work_dir / "tts_out.wav",
        )

        output = inputs.work_dir / "final_avatar.mp4"
        self._render(inputs, tts_wav, output)
        logger.info("mock inference rendered %s", output)
        return output

    def _render(self, inputs: TaskInputs, tts_wav, output) -> None:
        # Preferred: composite the avatar image with the synthesized speech,
        # producing a talking-avatar style placeholder video.
        if inputs.image_path.exists():
            cmd = [
                "ffmpeg", "-y", "-loglevel", "error",
                "-loop", "1", "-i", str(inputs.image_path),
                "-i", str(tts_wav),
            ]
            cmd += [
                "-vf",
                "scale=640:640:force_original_aspect_ratio=decrease,"
                "pad=640:640:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
                "-c:v", "libx264", "-preset", "veryfast",
                "-c:a", "aac", "-b:a", "128k",
                "-shortest",
                str(output),
            ]
            try:
                subprocess.run(cmd, check=True, capture_output=True, text=True)
                return
            except subprocess.CalledProcessError as exc:
                logger.warning(
                    "image composite failed, falling back to testsrc: %s",
                    exc.stderr[-500:],
                )

        # Fallback: synthetic test pattern video with a silent audio track.
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc=duration=3:size=640x360:rate=25",
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-t", "3",
            "-pix_fmt", "yuv420p",
            "-c:v", "libx264", "-preset", "veryfast",
            "-c:a", "aac",
            "-shortest",
            str(output),
        ]
        subprocess.run(cmd, check=True, capture_output=True, text=True)
