"""Streaming worker: continuous per-avatar FFmpeg pipe with a watchdog writer.

One live session per avatar keeps a single ffmpeg process pushing
`rtmp://localhost:1935/live/avatar_<id>` to SRS. The pipe is NEVER closed and
the **watchdog writer thread** pushes exactly `fps` frames per second (24 by
default), so the frontend player never sees a gap and never buffers ("转圈"):

  - The writer owns the pacing. Every 1/24s it pops the next ready frame from
    the `Ready_Frames_Queue` (lip-synced frames produced by the inference
    thread) and writes the matching per-frame audio slice.
  - If the queue is empty (idle, or Wav2Lip is still producing the first
    batch), it immediately falls back to the next pre-processed `base_video.mp4`
    frame + a silent audio slice. The avatar blinks/moves silently; when the
    first talking batch lands it switches seamlessly back to speech.
  - The inference thread (async): Edge-TTS runs in the background; finished
    audio is lip-synced in small Wav2Lip batches (8 frames) and pushed to the
    queue as fast as possible (faster than real-time), so consecutive chunks
    splice with no idle gap at all.

Face restoration (GFPGAN/CodeFormer) is intentionally OFF in the live pipeline:
it is ~1s/frame on Apple Silicon CoreML and cannot sustain 24fps.
"""

import json
import logging
import os
import queue as queue_mod
import requests
import shutil
import signal
import subprocess
import threading
import time
from pathlib import Path

import redis

from storage import S3Storage
from streaming.ffmpeg_pipe import AUDIO_SAMPLE_RATE, FFmpegPipeClosedError
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


class _AudioPacer:
    """Writes mono 16kHz s16le audio in per-frame slices.

    Each video frame at `fps` represents `sample_rate * 2 / fps` bytes of audio;
    writing exactly that many bytes per frame keeps the audio input flowing at
    real time and A/V aligned, without the half-second burst bookkeeping.
    """

    def __init__(self, fps: float, sample_rate: int = AUDIO_SAMPLE_RATE):
        self.bytes_per_frame = sample_rate * 2 / fps
        self._acc = 0.0
        self._last = 0
        self._audio: bytes | None = None
        self._written = 0

    def start(self, audio: bytes | None) -> None:
        self._audio = audio
        self._acc = 0.0
        self._last = 0
        self._written = 0

    def slice(self) -> bytes:
        """Bytes to write for the next frame (talking audio or silence)."""
        self._acc += self.bytes_per_frame
        target = int(round(self._acc))
        delta = target - self._last
        self._last = target
        if self._audio is not None:
            seg = self._audio[self._written : self._written + delta]
            self._written += len(seg)
            if len(seg) < delta:  # audio ended: pad silence, keep the stream alive
                seg += b"\x00" * (delta - len(seg))
            return seg
        return bytes(delta)

    def remaining(self) -> bytes:
        return self._audio[self._written :] if self._audio is not None else b""


class _TalkingSegment:
    """One lip-synced sentence waiting in the ready-frames queue."""

    __slots__ = ("text", "audio", "total_frames", "frames_written", "pacer")

    def __init__(self, text: str, audio: bytes, total_frames: int, fps: float):
        self.text = text
        self.audio = audio
        self.total_frames = total_frames
        self.frames_written = 0
        self.pacer = _AudioPacer(fps)
        self.pacer.start(audio)


class LiveAvatarSession:
    """One avatar's continuous live session (pipe + base clip + TTS buffer)."""

    def __init__(
        self,
        avatar_id: int,
        stream_id: str,
        image_path: Path,
        base_video_path: Path,
        voice_id: str,
        work_dir: Path,
        fps: float,
        queue_key: str,
        subtitle_settings: dict | None = None,
    ):
        self.avatar_id = avatar_id
        self.stream_id = stream_id
        self.image_path = image_path
        self.base_video_path = base_video_path
        self.voice_id = voice_id
        self.work_dir = work_dir
        self.fps = float(fps)
        self.queue_key = queue_key
        self.subtitle_settings = subtitle_settings or {}
        self.pipe = None
        self.base_frames: list | None = None
        self.cursor = 0
        self.lipsync = None
        self.tts = None
        self.ready = False

        # --- Watchdog architecture state ---
        # Ready_Frames_Queue: ("seg", _TalkingSegment) then ("frame", ndarray).
        # The writer thread consumes it at exactly fps; the inference thread
        # produces it. When empty, the writer falls back to base frames.
        self._talk_queue: queue_mod.Queue = queue_mod.Queue(maxsize=4096)
        # Finished TTS results waiting for the frame producer (text, wav|None).
        self._pending: queue_mod.Queue = queue_mod.Queue(maxsize=4)
        self._tts_results: queue_mod.Queue = queue_mod.Queue(maxsize=2)
        self._tts_thread: threading.Thread | None = None
        self._produce_thread: threading.Thread | None = None
        self._writer_thread: threading.Thread | None = None
        self._feed_thread: threading.Thread | None = None
        self._running = False
        self._dead = False
        self._subtitle = None
        self._subtitle_text = ""

    # ------------------------------------------------------------------ #
    # Setup
    # ------------------------------------------------------------------ #
    def setup(self) -> None:
        """Load the pre-processed base clip from S3 and open the ffmpeg pipe."""
        from ai.lipsync_onnx import Wav2LipOnnxLipSync
        from streaming.ffmpeg_pipe import FFmpegPipe

        if not self.base_video_path.exists():
            raise RuntimeError(f"base video not found: {self.base_video_path}")
        self.lipsync = Wav2LipOnnxLipSync()
        self.base_frames, base_fps = Wav2LipOnnxLipSync._read_frames(self.base_video_path)
        # Preload the Wav2Lip session + face detector so the FIRST sentence
        # starts as soon as TTS lands (lazy load would add 2-4s at talk time).
        try:
            self.lipsync._load_model()
            self.lipsync._face_detect(self.base_frames[:1])
            logger.info(
                "avatar %s lipsync model + face detector warmed up",
                self.avatar_id,
            )
        except Exception:
            logger.exception(
                "avatar %s lipsync warmup failed (will retry lazily)",
                self.avatar_id,
            )

        h, w = self.base_frames[0].shape[:2]
        self.pipe = FFmpegPipe(
            stream_id=self.stream_id,
            width=w,
            height=h,
            fps=self.fps,
            log_path=self.work_dir / "ffmpeg.log",
        )
        self.pipe.start()
        self.ready = True
        logger.info(
            "avatar %s live session ready: %d base frames @ %.1f fps, stream %s",
            self.avatar_id,
            len(self.base_frames),
            base_fps,
            self.stream_id,
        )

    # ------------------------------------------------------------------ #
    # Text intake (async TTS)
    # ------------------------------------------------------------------ #
    def maybe_start_tts(self, text: str) -> bool:
        """Kick off TTS for `text` if no TTS job is already running."""
        if self._tts_thread is not None and self._tts_thread.is_alive():
            return False
        self._tts_thread = threading.Thread(
            target=self._run_tts,
            args=(text,),
            daemon=True,
            name=f"tts-{self.stream_id}",
        )
        self._tts_thread.start()
        return True

    def _run_tts(self, text: str) -> None:
        try:
            wav = self._get_tts().synthesize(
                text,
                None,
                self.work_dir / f"chunk_{int(time.time() * 1000)}.wav",
            )
            logger.info("avatar %s TTS ready (%.1fs): %s", self.avatar_id, _wav_duration(wav), text)
            self._tts_results.put((text, wav))
        except Exception:
            logger.exception("avatar %s TTS failed for: %s", self.avatar_id, text)
            self._tts_results.put((text, None))

    def _get_tts(self):
        if self.tts is None:
            if self.voice_id:
                from ai.tts_edge import EdgeTTS

                self.tts = EdgeTTS(voice_id=self.voice_id)
            else:
                from ai.tts_real import GPTSoVITSTTS

                self.tts = GPTSoVITSTTS()
        return self.tts

    def start(self, r: redis.Redis) -> None:
        """Start the watchdog writer thread and the queue-management loop."""
        if self._feed_thread is not None and self._feed_thread.is_alive():
            return
        self._running = True
        self._writer_thread = threading.Thread(
            target=self._writer_loop,
            daemon=True,
            name=f"writer-{self.stream_id}",
        )
        self._writer_thread.start()
        self._feed_thread = threading.Thread(
            target=self._run_loop,
            args=(r,),
            daemon=True,
            name=f"feed-{self.stream_id}",
        )
        self._feed_thread.start()

    # ------------------------------------------------------------------ #
    # Watchdog writer thread (continuous 24fps consumer)
    # ------------------------------------------------------------------ #
    def _writer_loop(self) -> None:
        """Push exactly `fps` frames/second to ffmpeg, forever.

        Ready frames (lip-synced speech) are consumed from the queue as they
        arrive; when the queue is empty the writer immediately falls back to
        the next base-animation frame + a silent audio slice. This is what
        keeps the player from buffering while Wav2Lip works.
        """
        interval = 1.0 / self.fps
        idle_pacer = _AudioPacer(self.fps)
        idle_pacer.start(None)
        cur_seg: _TalkingSegment | None = None
        logger.info("avatar %s watchdog writer started @ %.3fs/frame", self.avatar_id, interval)
        try:
            while self._running:
                t0 = time.perf_counter()

                try:
                    kind, payload = self._talk_queue.get_nowait()
                except queue_mod.Empty:
                    kind, payload = None, None

                if kind == "seg" and payload is not None:
                    cur_seg = payload
                    self._subtitle_text = payload.text
                    kind = None  # this tick still writes an idle frame

                if kind == "seg_end":
                    # Producer aborted (e.g. TTS/Wav2Lip failure): abandon the
                    # current segment and fall back to idle immediately.
                    cur_seg = None
                    self._subtitle_text = ""
                    kind = None

                if kind == "frame" and cur_seg is not None:
                    audio = cur_seg.pacer.slice()
                    if audio:
                        self.pipe.write_audio(audio)
                    self._write_frame(payload)
                    cur_seg.frames_written += 1
                    if cur_seg.frames_written >= cur_seg.total_frames:
                        rest = cur_seg.pacer.remaining()
                        if rest:
                            self.pipe.write_audio(rest)
                        cur_seg = None
                        self._subtitle_text = ""
                else:
                    # Idle fallback: base animation + silence, never blocking.
                    audio = idle_pacer.slice()
                    if audio:
                        self.pipe.write_audio(audio)
                    self._write_frame(self._idle_frame())

                delay = interval - (time.perf_counter() - t0)
                if delay > 0:
                    time.sleep(delay)
        except FFmpegPipeClosedError as exc:
            logger.error(
                "session %s pipe closed: %s — stopping watchdog writer; "
                "restart the live to rebuild the pipe",
                self.stream_id,
                exc,
            )
            self._dead = True
            self._running = False
            if self.pipe is not None:
                self.pipe.stop()
        except Exception:
            logger.exception("session %s writer error, stopping", self.stream_id)
            self._dead = True
            self._running = False
            if self.pipe is not None:
                self.pipe.stop()

    def _idle_frame(self):
        frame = self.base_frames[self.cursor % len(self.base_frames)]
        self.cursor += 1
        return frame

    # ------------------------------------------------------------------ #
    # Queue management loop (lightweight; no pipe I/O)
    # ------------------------------------------------------------------ #
    def tick(self, r: redis.Redis) -> None:
        """Pop text, hand finished TTS to the producer, keep queues fed."""
        # 1) Pull new text when no TTS is in flight and pending has room.
        if (
            self._tts_thread is None or not self._tts_thread.is_alive()
        ) and not self._pending.full():
            new_text = r.lpop(self.queue_key)
            if new_text:
                self.maybe_start_tts(new_text)

        # 2) Move finished TTS results into the producer's pending queue.
        try:
            text, wav = self._tts_results.get_nowait()
            self._pending.put((text, wav))
        except queue_mod.Empty:
            pass

        # 3) Start the frame producer when it is idle and work is pending.
        if (
            self._produce_thread is None or not self._produce_thread.is_alive()
        ) and not self._pending.empty():
            text, wav = self._pending.get_nowait()
            self._produce_thread = threading.Thread(
                target=self._produce_segment,
                args=(text, wav),
                daemon=True,
                name=f"produce-{self.stream_id}",
            )
            self._produce_thread.start()
        time.sleep(0.05)

    def _run_loop(self, r: redis.Redis) -> None:
        while self._running:
            if self._dead:
                break
            try:
                self.tick(r)
            except FFmpegPipeClosedError as exc:
                logger.error(
                    "session %s pipe closed: %s — stopping feed loop; "
                    "restart the live to rebuild the pipe",
                    self.stream_id,
                    exc,
                )
                self._dead = True
                self._running = False
                self.close()
                break
            except Exception:
                logger.exception("session %s feed error, continuing", self.stream_id)
                time.sleep(0.2)

    # ------------------------------------------------------------------ #
    # Inference producer (async; Wav2Lip in small batches)
    # ------------------------------------------------------------------ #
    def _produce_segment(self, text: str, wav) -> None:
        """Lip-sync `wav` in small batches and push frames to the writer queue.

        Runs on its own thread so it never blocks the 24fps writer. The segment
        marker is pushed BEFORE the frames so the writer can start the talking
        state as soon as the first batch lands; time-to-first-frame is one
        Wav2Lip batch (~8 frames).
        """
        if wav is None:
            logger.warning("avatar %s chunk skipped (TTS failed)", self.avatar_id)
            return
        try:
            audio = self.lipsync.audio_pcm16(wav)
            n_frames = len(self.lipsync._mel_chunks(wav, self.fps))
            seg = _TalkingSegment(text, audio, n_frames, self.fps)
            self._talk_queue.put(("seg", seg))
            base_slice = self._slice_base(n_frames)
            frames = self.lipsync.iter_frames(wav, base_slice, self.fps)
            pushed = 0
            for frame in frames:
                self._talk_queue.put(("frame", frame))
                pushed += 1
            logger.info(
                "avatar %s talking segment queued: %d frames (%.1fs speech)",
                self.avatar_id,
                pushed,
                len(audio) / 2 / AUDIO_SAMPLE_RATE,
            )
        except Exception:
            logger.exception("avatar %s segment production failed", self.avatar_id)
            # Let the watchdog drop the unfinished segment and go back to idle.
            try:
                self._talk_queue.put(("seg_end", None))
            except Exception:
                pass

    def _write_frame(self, frame) -> None:
        """Apply the subtitle overlay then push the frame into the pipe."""
        if self._subtitle_text and self._subtitle_enabled():
            if self._subtitle is None:
                from streaming.subtitle import SubtitleRenderer

                self._subtitle = self._make_subtitle_renderer()
            frame = self._subtitle.draw(frame, self._subtitle_text)
        self.pipe.write_frame(frame)

    def _subtitle_enabled(self) -> bool:
        return bool(self.subtitle_settings.get("subtitleEnabled", True))

    def _make_subtitle_renderer(self):
        from streaming.subtitle import SubtitleRenderer

        font_name = (self.subtitle_settings.get("subtitleFont") or "").strip()
        font_path = SubtitleRenderer.resolve_font_path(font_name)
        return SubtitleRenderer(
            font_path=font_path,
            font_size=int(self.subtitle_settings.get("subtitleSize") or 46),
            position=self.subtitle_settings.get("subtitlePosition") or "bottom",
            border_width=int(self.subtitle_settings.get("subtitleBorder") or 2),
        )

    def _slice_base(self, n: int) -> list:
        if not self.base_frames:
            raise RuntimeError("base frames not ready")
        seg = [self.base_frames[(self.cursor + k) % len(self.base_frames)] for k in range(n)]
        self.cursor += n
        return seg

    def close(self) -> None:
        self._running = False
        for thread in (self._writer_thread, self._feed_thread, self._produce_thread):
            if (
                thread is not None
                and thread.is_alive()
                and thread is not threading.current_thread()
            ):
                thread.join(timeout=5)
        if self.pipe is not None:
            self.pipe.stop()


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


def _control_listener(
    r: redis.Redis,
    control_key: str,
    sessions: dict,
    storage: S3Storage,
    work_root: Path,
    fps: float,
) -> None:
    """Daemon thread: handle start/stop control messages for avatar sessions."""
    while True:
        try:
            # Drop sessions whose ffmpeg pipe died so a new start can rebuild.
            for aid, sess in list(sessions.items()):
                if getattr(sess, "_dead", False):
                    logger.warning(
                        "avatar %s session dead, removing it so a new start can rebuild",
                        aid,
                    )
                    sessions.pop(aid, None)

            item = r.blpop(control_key, timeout=1)
            if item is None:
                continue
            payload = json.loads(item[1])
            action = payload.get("action")
            avatar_id = int(payload.get("avatarId"))
            stream_id = payload.get("streamId") or f"avatar_{avatar_id}"

            if action == "stop":
                session = sessions.pop(avatar_id, None)
                if session:
                    session.close()
                    logger.info("avatar %s live session stopped", avatar_id)
                continue

            if avatar_id in sessions:
                logger.info("avatar %s live session already running", avatar_id)
                continue

            threading.Thread(
                target=_setup_session,
                args=(payload, stream_id, storage, work_root, fps, sessions, r),
                daemon=True,
                name=f"setup-{stream_id}",
            ).start()
        except redis.RedisError:
            logger.exception("redis error in control listener, retrying in 5s")
            time.sleep(5)
        except Exception:
            logger.exception("unexpected control listener error, continuing")
            time.sleep(1)


def _setup_session(payload, stream_id, storage, work_root, fps, sessions, r) -> None:
    try:
        avatar_id = int(payload["avatarId"])
        work_dir = work_root / f"live-{stream_id}"
        if work_dir.exists():
            shutil.rmtree(work_dir, ignore_errors=True)
        work_dir.mkdir(parents=True)
        image_path = work_dir / ("image" + Path(payload["imageS3Key"]).suffix)
        storage.download(payload["imageS3Key"], image_path)
        if not payload.get("baseVideoS3Key"):
            logger.error(
                "control message for %s has no baseVideoS3Key; "
                "run the avatar pre-processing step first",
                stream_id,
            )
            return
        base_video_path = work_dir / "base_video.mp4"
        storage.download(payload["baseVideoS3Key"], base_video_path)
        session = LiveAvatarSession(
            avatar_id=avatar_id,
            stream_id=stream_id,
            image_path=image_path,
            base_video_path=base_video_path,
            voice_id=payload.get("voiceId", ""),
            work_dir=work_dir,
            fps=fps,
            queue_key=f"live_queue:{avatar_id}",
            subtitle_settings=payload.get("liveSettings") or {},
        )
        session.setup()
        sessions[avatar_id] = session
        session.start(r)
    except Exception:
        logger.exception("failed to set up live session for %s", payload.get("streamId"))


def _restore_sessions(api_base_url, sessions, storage, work_root, fps, r) -> None:
    """Re-start live sessions that are persisted in the DB after a worker
    restart (the DB row survives but the in-memory pipe does not)."""
    url = f"{api_base_url}/api/live"
    for attempt in range(5):
        try:
            resp = requests.get(url, timeout=5)
            resp.raise_for_status()
            items = resp.json().get("data", [])
            for item in items:
                aid = int(item["avatarId"])
                if aid in sessions:
                    continue
                stream_id = item.get("streamId") or f"avatar_{aid}"
                payload = {
                    "action": "start",
                    "avatarId": aid,
                    "streamId": stream_id,
                    "imageS3Key": item.get("imageS3Key", ""),
                    "baseVideoS3Key": item.get("baseVideoS3Key", ""),
                    "voiceId": item.get("voiceId", ""),
                    "liveSettings": item.get("liveSettings") or {},
                }
                if not payload["imageS3Key"] or not payload["baseVideoS3Key"]:
                    logger.warning(
                        "session for avatar %s missing S3 keys, skip restore", aid
                    )
                    continue
                logger.info("restoring live session for avatar %s", aid)
                threading.Thread(
                    target=_setup_session,
                    args=(payload, stream_id, storage, work_root, fps, sessions, r),
                    daemon=True,
                    name=f"restore-{aid}",
                ).start()
            return
        except Exception as exc:
            logger.warning(
                "live session restore attempt %d/%d failed: %s",
                attempt + 1,
                5,
                exc,
            )
            time.sleep(5)


def main() -> None:
    _load_local_env()
    _check_required_env()
    if os.environ.get("TTS_ENGINE", "edge") == "gpt-sovits":
        _ensure_nltk_resources()
    cfg = load_config()
    work_root = cfg["work_root"]
    fps = float(os.environ.get("LIVEPORTRAIT_OUTPUT_FPS", "24"))
    control_key = os.environ.get(
        "LIVE_CONTROL_QUEUE_KEY", "talking_avatar:live_control"
    )

    storage = S3Storage()
    r = redis.Redis(
        host=cfg["redis_host"],
        port=cfg["redis_port"],
        password=cfg["redis_password"] or None,
        db=cfg["redis_db"],
        decode_responses=True,
    )

    sessions: dict[int, LiveAvatarSession] = {}
    threading.Thread(
        target=_control_listener,
        args=(r, control_key, sessions, storage, work_root, fps),
        daemon=True,
        name="live-control",
    ).start()
    threading.Thread(
        target=_restore_sessions,
        args=(cfg["api_base_url"], sessions, storage, work_root, fps, r),
        daemon=True,
        name="live-restore",
    ).start()

    def _shutdown(*_args):
        logger.info("shutting down %d live session(s)", len(sessions))
        for session in sessions.values():
            session.close()
        raise SystemExit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    logger.info("stream worker started: control=%s fps=%s", control_key, fps)

    # Feed loops now run per session (see LiveAvatarSession.start); the main
    # thread only keeps the process alive for signal handling.
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()
