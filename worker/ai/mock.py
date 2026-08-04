import logging
import subprocess
import time

from .base import InferencePipeline, TaskInputs

logger = logging.getLogger(__name__)


class MockPipeline(InferencePipeline):
    """Dummy AI pipeline used while the real TTS/face-driving models are not
    integrated yet: sleeps, then renders a short MP4 with ffmpeg.

    Swap this out by registering a real pipeline in factory.create_pipeline;
    the orchestration around it (S3 download/upload, Redis, callback) stays
    untouched.
    """

    def __init__(self, sleep_seconds: int = 10):
        self.sleep_seconds = sleep_seconds

    def run(self, inputs: TaskInputs):
        logger.info("mock inference: sleeping %s seconds", self.sleep_seconds)
        time.sleep(self.sleep_seconds)

        output = inputs.work_dir / "final_avatar.mp4"
        self._render(inputs, output)
        logger.info("mock inference rendered %s", output)
        return output

    def _render(self, inputs: TaskInputs, output) -> None:
        # Preferred: composite the uploaded avatar image with a silent audio
        # track, producing a realistic-looking placeholder video.
        if inputs.image_path.exists():
            cmd = [
                "ffmpeg", "-y", "-loglevel", "error",
                "-loop", "1", "-i", str(inputs.image_path),
                "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                "-t", "3",
                "-vf",
                "scale=640:640:force_original_aspect_ratio=decrease,"
                "pad=640:640:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
                "-c:v", "libx264", "-preset", "veryfast",
                "-c:a", "aac",
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

        # Fallback: synthetic test pattern video.
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc=duration=3:size=640x360:rate=25",
            "-pix_fmt", "yuv420p",
            "-c:v", "libx264", "-preset", "veryfast",
            str(output),
        ]
        subprocess.run(cmd, check=True, capture_output=True, text=True)
