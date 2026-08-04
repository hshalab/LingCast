import logging
import subprocess
from pathlib import Path

from .base import Renderer

logger = logging.getLogger(__name__)


class MockRenderer(Renderer):
    """Placeholder renderer: composites the avatar image with the TTS audio
    using ffmpeg. Replaced by LivePortraitRenderer in AI_MODE=real."""

    def render(self, image_path: Path, tts_wav: Path, work_dir: Path) -> Path:
        output = work_dir / "final_avatar.mp4"

        if image_path.exists():
            cmd = [
                "ffmpeg", "-y", "-loglevel", "error",
                "-loop", "1", "-i", str(image_path),
                "-i", str(tts_wav),
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
                logger.info("mock renderer wrote %s", output)
                return output
            except subprocess.CalledProcessError as exc:
                logger.warning(
                    "image composite failed, falling back to testsrc: %s",
                    exc.stderr[-500:],
                )

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
        logger.info("mock renderer wrote fallback %s", output)
        return output
