"""GPU-free TTS via Microsoft Edge's online neural voices (edge-tts).

Replaces GPT-SoVITS in the broadcast/live usage pipelines: no GPU, no model
downloads, single-digit-second latency for a sentence. The voice is selected
per-avatar via `voice_id` (e.g. zh-CN-XiaoxiaoNeural).
"""

import asyncio
import logging
import subprocess
from pathlib import Path

import edge_tts

logger = logging.getLogger(__name__)

DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"


class EdgeTTS:
    """Synthesize speech with an Edge-TTS voice, output 16k mono WAV."""

    def __init__(self, voice_id: str = DEFAULT_VOICE):
        self.voice_id = voice_id or DEFAULT_VOICE

    def synthesize(
        self,
        text: str,
        reference_audio: Path | None = None,
        out_wav: Path | None = None,
    ) -> Path:
        """Generate `out_wav` (16kHz mono) from `text` with the configured voice.

        `reference_audio` is accepted for interface compatibility with
        GPT-SoVITS but is unused: Edge-TTS selects the voice by id.
        """
        out_wav = Path(out_wav) if out_wav is not None else Path("/tmp/edge_tts_out.wav")
        out_wav.parent.mkdir(parents=True, exist_ok=True)
        mp3 = out_wav.with_suffix(".mp3")

        async def _run() -> None:
            communicate = edge_tts.Communicate(text, self.voice_id)
            await communicate.save(str(mp3))

        asyncio.run(_run())
        subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", str(mp3),
                "-ar", "16000", "-ac", "1",
                str(out_wav),
            ],
            check=True,
        )
        mp3.unlink(missing_ok=True)
        logger.info("edge-tts %s synthesized %.1fs of audio -> %s", self.voice_id, _wav_duration(out_wav), out_wav)
        return out_wav


def _wav_duration(wav: Path) -> float:
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)],
        capture_output=True,
        text=True,
    )
    try:
        return float(probe.stdout.strip())
    except ValueError:
        return 0.0
