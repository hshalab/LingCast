import logging
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)


def _has_cjk(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


class MockTTS:
    """Simulated voice-clone TTS.

    In the real pipeline the uploaded reference audio is the *base timbre*
    and the script text is synthesized in that voice (e.g. GPT-SoVITS).
    This mock keeps the same interface but simply reads the script aloud with
    an offline TTS engine, so the whole S3/Redis/video pipeline can be
    exercised without a trained model. Swap this class (or the whole
    pipeline) for the real clone model later.
    """

    def __init__(self, rate: int = 175, pitch: int = 50):
        self.rate = rate
        self.pitch = pitch

    def synthesize(
        self,
        script_text: str,
        reference_audio: Path | None,
        out_wav: Path,
    ) -> Path:
        """Render `script_text` as speech into `out_wav`.

        `reference_audio` is the cloning base in the real model; the mock only
        carries it through so the interface matches the final design.
        """
        out_wav.parent.mkdir(parents=True, exist_ok=True)
        if shutil.which("espeak-ng"):
            self._espeak(script_text, out_wav)
        elif shutil.which("say"):
            self._say(script_text, out_wav)
        else:
            raise RuntimeError(
                "no TTS engine available in worker image "
                "(install espeak-ng or run on macOS with 'say')"
            )

        if not out_wav.exists() or out_wav.stat().st_size == 0:
            raise RuntimeError("mock TTS produced an empty audio file")
        return out_wav

    def _espeak(self, text: str, out_wav: Path) -> None:
        # espeak-ng: cmn = Mandarin, en = English. Chinese scripts are the
        # platform's primary use case.
        voice = "cmn" if _has_cjk(text) else "en"
        cmd = [
            "espeak-ng", "-v", voice,
            "-s", str(self.rate),
            "-p", str(self.pitch),
            "-w", str(out_wav),
            text,
        ]
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        logger.info("mock TTS rendered script to %s (espeak-ng, voice=%s)", out_wav, voice)

    def _say(self, text: str, out_wav: Path) -> None:
        # macOS fallback for local development.
        cmd = ["say", "-o", str(out_wav), "--data-format=LEI16@44100", text]
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        logger.info("mock TTS rendered script to %s (say)", out_wav)
