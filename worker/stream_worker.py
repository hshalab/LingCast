"""Streaming worker: Redis sentence chunks -> TTS -> Wav2Lip frames -> RTMP.

The offline MP4 pipeline (worker.py) is untouched. This entry point turns a
live avatar stream into memory-to-network video:

  1. A poller thread pulls sentence chunks from the stream queue
     (talking_avatar:stream_tasks) and enqueues TTS jobs per stream.
  2. Each stream owns one TTS producer thread, so while chunk N frames are
     being lip-synced and piped, chunk N+1..N+k are already being synthesized
     (backpressure via bounded result queue).
  3. The main thread consumes TTS results in strict order, slices the cached
     base animation, runs Wav2Lip ONNX in memory and pipes BGR24 frames +
     16k PCM audio into one ffmpeg process that pushes to SRS
     (rtmp://localhost:1935/live/<stream_id>).

Audio is written *before* the video frames of each chunk: ffmpeg waits for the
first packet of every input before consuming, so writing all video first
deadlocks the pipe (see streaming/ffmpeg_pipe.py).
"""

import json
import logging
import os
import queue as queue_mod
import shutil
import signal
import threading
import time
from pathlib import Path

import redis

from storage import S3Storage
from worker import (
    _check_required_env,
    _ensure_nltk_resources,
    _load_local_env,
    load_config,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("stream_worker")

_STOP = object()


class StreamSession:
    """One live stream: owns the ffmpeg pipe, cached base animation and the
    async TTS prefetch pipeline (jobs -> producer -> results)."""

    def __init__(
        self,
        stream_id: str,
        image_path: Path,
        audio_path: Path | None,
        work_dir: Path,
        fps: float,
        async_enabled: bool,
    ):
        self.stream_id = stream_id
        self.image_path = image_path
        self.audio_path = audio_path
        self.work_dir = work_dir
        self.fps = float(fps)
        self.async_enabled = async_enabled
        self.pipe = None
        self.base_frames: list | None = None
        self.cursor = 0
        self.lipsync = None
        self.tts = None
        self._jobs: queue_mod.Queue = queue_mod.Queue(maxsize=64)
        self._results: queue_mod.Queue = queue_mod.Queue(maxsize=8)
        self._producer: threading.Thread | None = None
        if self.async_enabled:
            self._producer = threading.Thread(
                target=self._produce,
                daemon=True,
                name=f"tts-{self.stream_id}",
            )
            self._producer.start()

    # ------------------------------------------------------------------ #
    # Chunk intake
    # ------------------------------------------------------------------ #
    def enqueue(self, chunk_index: int, text: str) -> None:
        """Queue one chunk's TTS job. In sync mode the TTS runs inline."""
        if not self.async_enabled:
            self._results.put((chunk_index, self._synthesize(chunk_index, text)))
            return
        self._jobs.put((chunk_index, text))

    def next_result(self, timeout: float | None = None):
        """Blocking (optionally with timeout): next (chunk_index, wav) in order."""
        try:
            return self._results.get(timeout=timeout)
        except queue_mod.Empty:
            return None

    def _produce(self) -> None:
        while True:
            item = self._jobs.get()
            if item is _STOP:
                return
            chunk_index, text = item
            self._results.put((chunk_index, self._synthesize(chunk_index, text)))

    def _synthesize(self, chunk_index: int, text: str) -> Path | None:
        try:
            wav = self._get_tts().synthesize(
                text,
                self.audio_path,
                self.work_dir / f"chunk_{chunk_index}.wav",
            )
            logger.info(
                "stream %s chunk %d TTS ready (%.1fs)",
                self.stream_id,
                chunk_index,
                _wav_duration(wav),
            )
            return wav
        except Exception:
            logger.exception("stream %s chunk %d TTS failed", self.stream_id, chunk_index)
            return None

    # ------------------------------------------------------------------ #
    # Chunk processing -> ffmpeg pipe
    # ------------------------------------------------------------------ #
    def process(self, chunk_index: int, tts_wav: Path | None) -> None:
        """Lip-sync one chunk in memory and push frames + audio to SRS."""
        if tts_wav is None:
            logger.warning("stream %s chunk %d skipped (TTS failed)", self.stream_id, chunk_index)
            return

        self._ensure_base(tts_wav)
        if self.pipe is None:
            from streaming.ffmpeg_pipe import FFmpegPipe

            h, w = self.base_frames[0].shape[:2]
            self.pipe = FFmpegPipe(
                stream_id=self.stream_id,
                width=w,
                height=h,
                fps=self.fps,
                log_path=self.work_dir / "ffmpeg.log",
            )
            self.pipe.start()

        # Interleave audio with video in half-second slices. The FIRST audio
        # slice goes out before any frame: ffmpeg waits for the first packet of
        # every input before consuming, so writing video first deadlocks. A
        # whole chunk's audio at once overflows ffmpeg's pre-video buffering
        # and deadlocks the other way.
        from streaming.ffmpeg_pipe import AUDIO_SAMPLE_RATE

        audio = self.lipsync.audio_pcm16(tts_wav)
        half_sec_bytes = AUDIO_SAMPLE_RATE * 2 // 2  # 0.5s of s16le mono
        half_sec_frames = max(1, int(round(self.fps / 2)))

        n_frames = len(self.lipsync._mel_chunks(tts_wav, self.fps))
        segment = self._slice_base(n_frames)
        audio_pos = min(half_sec_bytes, len(audio))
        self.pipe.write_audio(audio[:audio_pos])

        written = 0
        for frame in self.lipsync.iter_frames(tts_wav, segment, self.fps):
            if written > 0 and written % half_sec_frames == 0 and audio_pos < len(audio):
                end = min(audio_pos + half_sec_bytes, len(audio))
                self.pipe.write_audio(audio[audio_pos:end])
                audio_pos = end
            self.pipe.write_frame(frame)
            written += 1
        if audio_pos < len(audio):
            self.pipe.write_audio(audio[audio_pos:])
        logger.info(
            "stream %s chunk %d piped: %d frames, cursor=%d",
            self.stream_id,
            chunk_index,
            written,
            self.cursor,
        )

    def _ensure_base(self, tts_wav: Path) -> None:
        """Render the base animation once per stream (first chunk's duration)."""
        if self.base_frames is not None:
            return
        from ai.lipsync_onnx import Wav2LipOnnxLipSync
        from ai.renderer_real import LivePortraitRenderer

        self.lipsync = Wav2LipOnnxLipSync()
        renderer = LivePortraitRenderer(output_fps=int(round(self.fps)))
        base_video = renderer.render(self.image_path, tts_wav, self.work_dir)
        self.base_frames, base_fps = Wav2LipOnnxLipSync._read_frames(base_video)
        logger.info(
            "stream %s base video ready: %d frames @ %.1f fps",
            self.stream_id,
            len(self.base_frames),
            base_fps,
        )

    def _slice_base(self, n: int) -> list:
        """Take the next `n` base frames, wrapping at the end of the clip."""
        if not self.base_frames:
            raise RuntimeError("base frames not ready")
        seg = [self.base_frames[(self.cursor + k) % len(self.base_frames)] for k in range(n)]
        self.cursor += n
        return seg

    def _get_tts(self):
        if self.tts is None:
            from ai.tts_real import GPTSoVITSTTS

            self.tts = GPTSoVITSTTS()
        return self.tts

    def close(self) -> None:
        if self._producer is not None and self._producer.is_alive():
            self._jobs.put(_STOP)
        if self.pipe is not None:
            self.pipe.stop()


def _wav_duration(wav: Path) -> float:
    import subprocess

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)],
        capture_output=True,
        text=True,
    )
    try:
        return float(probe.stdout.strip())
    except ValueError:
        return 0.0


def _poll_streams(
    r: redis.Redis,
    queue_key: str,
    sessions: dict,
    storage: S3Storage,
    work_root: Path,
    fps: float,
    async_enabled: bool,
) -> None:
    """Daemon thread: BLPOP chunks and enqueue TTS jobs on the right session."""
    while True:
        try:
            item = r.blpop(queue_key, timeout=1)
            if item is None:
                continue
            payload = json.loads(item[1])
            logger.info("received stream chunk: %s", payload)

            stream_id = payload["streamId"]
            session = sessions.get(stream_id)
            if session is None:
                work_dir = work_root / f"stream-{stream_id}"
                if work_dir.exists():
                    shutil.rmtree(work_dir, ignore_errors=True)
                work_dir.mkdir(parents=True)
                image_path = work_dir / ("image" + Path(payload["imageS3Key"]).suffix)
                storage.download(payload["imageS3Key"], image_path)
                audio_path = None
                if payload.get("voiceAudioS3Key"):
                    audio_path = work_dir / (
                        "voice" + Path(payload["voiceAudioS3Key"]).suffix
                    )
                    storage.download(payload["voiceAudioS3Key"], audio_path)
                session = StreamSession(
                    stream_id=stream_id,
                    image_path=image_path,
                    audio_path=audio_path,
                    work_dir=work_dir,
                    fps=fps,
                    async_enabled=async_enabled,
                )
                sessions[stream_id] = session

            session.enqueue(payload["chunkIndex"], payload["text"])
        except redis.RedisError:
            logger.exception("redis connection error, retrying in 5s")
            time.sleep(5)
        except Exception:
            logger.exception("unexpected poller error, continuing")
            time.sleep(1)


def main() -> None:
    _load_local_env()
    _check_required_env()
    _ensure_nltk_resources()
    cfg = load_config()
    stream_queue_key = cfg["stream_queue_key"]
    work_root = cfg["work_root"]
    fps = float(os.environ.get("LIVEPORTRAIT_OUTPUT_FPS", "24"))
    async_enabled = os.environ.get("STREAM_ASYNC", "1") == "1"

    storage = S3Storage()
    r = redis.Redis(
        host=cfg["redis_host"],
        port=cfg["redis_port"],
        password=cfg["redis_password"] or None,
        db=cfg["redis_db"],
        decode_responses=True,
    )

    sessions: dict[str, StreamSession] = {}
    poller = threading.Thread(
        target=_poll_streams,
        args=(r, stream_queue_key, sessions, storage, work_root, fps, async_enabled),
        daemon=True,
        name="stream-poller",
    )
    poller.start()

    def _shutdown(*_args):
        logger.info("shutting down %d stream session(s)", len(sessions))
        for session in sessions.values():
            session.close()
        raise SystemExit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    logger.info(
        "stream worker started: queue=%s fps=%s async=%s",
        stream_queue_key,
        fps,
        async_enabled,
    )

    while True:
        try:
            active = False
            for session in list(sessions.values()):
                result = session.next_result(timeout=0.5)
                if result is None:
                    continue
                active = True
                session.process(*result)
            if not active:
                time.sleep(0.2)
        except Exception:
            logger.exception("unexpected stream worker error, continuing")
            time.sleep(1)


if __name__ == "__main__":
    main()
