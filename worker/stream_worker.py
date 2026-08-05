"""Streaming worker: continuous per-avatar FFmpeg pipe with idle/talking loop.

One live session per avatar keeps a single ffmpeg process pushing
`rtmp://localhost:1935/live/avatar_<id>` to SRS. The pipe is NEVER closed
between chunks:

  - IDLE: feed base animation frames + numpy-generated silent audio. The
    avatar blinks/moves naturally but does not speak.
  - TALKING: a text chunk popped from `live_queue:<avatar_id>` is synthesized
    by GPT-SoVITS (async), then Wav2Lip (ONNX) patches the base frames and the
    lip-synced frames + TTS audio replace the idle stream. When the chunk is
    done the loop falls straight back to IDLE on the same pipe.

FPS and resolution are identical in both states because talking frames are
generated from the same cached base clip. Video input uses ffmpeg `-re` so the
stream advances at exactly 1x real time; audio slices are written aligned with
every `fps/2` frames, so A/V stays in sync and never overruns.
"""

import json
import logging
import os
import queue as queue_mod
import shutil
import signal
import subprocess
import threading
import time
import wave
from pathlib import Path

import numpy as np
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


def _make_silent_wav(path: Path, seconds: float, sample_rate: int = 16000) -> Path:
    """Write a silent mono WAV so the base animation can be rendered before
    any text arrives (the renderer only needs the audio duration)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(b"\x00\x00" * int(sample_rate * seconds))
    return path


class LiveAvatarSession:
    """One avatar's continuous live session (pipe + base clip + TTS buffer)."""

    def __init__(
        self,
        avatar_id: int,
        stream_id: str,
        image_path: Path,
        audio_path: Path | None,
        work_dir: Path,
        fps: float,
        queue_key: str,
    ):
        self.avatar_id = avatar_id
        self.stream_id = stream_id
        self.image_path = image_path
        self.audio_path = audio_path
        self.work_dir = work_dir
        self.fps = float(fps)
        self.queue_key = queue_key
        self.pipe = None
        self.base_frames: list | None = None
        self.cursor = 0
        self.lipsync = None
        self.tts = None
        self.ready = False

        # Talking chunk state (one at a time; TTS runs async while idle).
        self._tts_results: queue_mod.Queue = queue_mod.Queue(maxsize=2)
        self._tts_thread: threading.Thread | None = None
        self.talking = None  # dict with audio/frames/iter state

    # ------------------------------------------------------------------ #
    # Setup
    # ------------------------------------------------------------------ #
    def setup(self) -> None:
        """Render the base clip once (10s silent template loop) and open pipe."""
        from ai.lipsync_onnx import Wav2LipOnnxLipSync
        from ai.renderer_real import LivePortraitRenderer
        from streaming.ffmpeg_pipe import FFmpegPipe

        silent = _make_silent_wav(
            self.work_dir / "silent_base.wav",
            float(os.environ.get("LIVEPORTRAIT_IDLE_BASE_SECONDS", "10")),
        )
        self.lipsync = Wav2LipOnnxLipSync()
        renderer = LivePortraitRenderer(output_fps=int(round(self.fps)))
        base_video = renderer.render(self.image_path, silent, self.work_dir)
        self.base_frames, base_fps = Wav2LipOnnxLipSync._read_frames(base_video)

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
                self.audio_path,
                self.work_dir / f"chunk_{int(time.time() * 1000)}.wav",
            )
            logger.info("avatar %s TTS ready (%.1fs): %s", self.avatar_id, _wav_duration(wav), text)
            self._tts_results.put((text, wav))
        except Exception:
            logger.exception("avatar %s TTS failed for: %s", self.avatar_id, text)
            self._tts_results.put((text, None))

    def _get_tts(self):
        if self.tts is None:
            from ai.tts_real import GPTSoVITSTTS

            self.tts = GPTSoVITSTTS()
        return self.tts

    # ------------------------------------------------------------------ #
    # Idle / talking block feeding
    # ------------------------------------------------------------------ #
    def tick(self, r: redis.Redis) -> None:
        """Advance one 0.5s block: take text, switch states, feed the pipe."""
        # 1) Pull new text from the per-avatar queue when we have no chunk and
        #    no TTS in flight (LPOP keeps the chunk atomic for this worker).
        if self.talking is None and not self._tts_results.qsize():
            text = r.lpop(self.queue_key)
            if text:
                self.maybe_start_tts(text)

        # 2) A finished TTS chunk switches the pipe from idle to talking.
        if self.talking is None:
            try:
                text, wav = self._tts_results.get_nowait()
            except queue_mod.Empty:
                wav = None
            if wav is not None:
                self._begin_talking(wav)
            elif wav is None and text is not None:
                logger.warning("avatar %s chunk skipped (TTS failed)", self.avatar_id)

        # 3) Feed exactly one block. `-re` on the video input paces everything.
        if self.talking is not None:
            if self._feed_talking_block():
                self.talking = None
                logger.info("avatar %s back to idle", self.avatar_id)
        else:
            self._feed_idle_block()

    def _feed_idle_block(self) -> None:
        from streaming.ffmpeg_pipe import AUDIO_SAMPLE_RATE

        half_sec_bytes = AUDIO_SAMPLE_RATE * 2 // 2
        half_sec_frames = max(1, int(round(self.fps / 2)))
        self.pipe.write_audio(b"\x00\x00" * (half_sec_bytes // 2))
        for _ in range(half_sec_frames):
            frame = self.base_frames[self.cursor % len(self.base_frames)]
            self.cursor += 1
            self.pipe.write_frame(frame)

    def _begin_talking(self, tts_wav: Path) -> None:
        from streaming.ffmpeg_pipe import AUDIO_SAMPLE_RATE

        audio = self.lipsync.audio_pcm16(tts_wav)
        half_sec_bytes = AUDIO_SAMPLE_RATE * 2 // 2
        half_sec_frames = max(1, int(round(self.fps / 2)))
        n_frames = len(self.lipsync._mel_chunks(tts_wav, self.fps))
        self.talking = {
            "audio": audio,
            "audio_pos": 0,
            "half_sec_bytes": half_sec_bytes,
            "half_sec_frames": half_sec_frames,
            "total_frames": n_frames,
            "frames": self.lipsync.iter_frames(
                tts_wav,
                self._slice_base(n_frames),
                self.fps,
            ),
            "written": 0,
        }
        logger.info("avatar %s talking: %d frames", self.avatar_id, n_frames)

    def _feed_talking_block(self) -> bool:
        """Feed one 0.5s block of lip-synced frames + audio slice.

        Returns True when the chunk is fully consumed (back to idle).
        """
        t = self.talking
        half_sec_frames = t["half_sec_frames"]

        # First audio slice precedes any frame: ffmpeg waits for the first
        # packet of every input before consuming, so video-first deadlocks.
        if t["written"] == 0:
            self._write_talking_audio(t)

        for _ in range(half_sec_frames):
            if t["written"] >= t["total_frames"]:
                break
            try:
                frame = next(t["frames"])
            except StopIteration:
                break
            self.pipe.write_frame(frame)
            t["written"] += 1

        # One audio slice per half-second of video keeps A/V interleaved.
        if t["written"] > 0 and t["written"] % half_sec_frames == 0:
            self._write_talking_audio(t)

        done = t["written"] >= t["total_frames"]
        if done:
            self._write_talking_audio(t)  # flush any trailing audio
        return done

    def _write_talking_audio(self, t: dict) -> None:
        end = min(t["audio_pos"] + t["half_sec_bytes"], len(t["audio"]))
        if t["audio_pos"] < len(t["audio"]):
            self.pipe.write_audio(t["audio"][t["audio_pos"] : end])
            t["audio_pos"] = end

    def _slice_base(self, n: int) -> list:
        if not self.base_frames:
            raise RuntimeError("base frames not ready")
        seg = [self.base_frames[(self.cursor + k) % len(self.base_frames)] for k in range(n)]
        self.cursor += n
        return seg

    def close(self) -> None:
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
                args=(payload, stream_id, storage, work_root, fps, sessions),
                daemon=True,
                name=f"setup-{stream_id}",
            ).start()
        except redis.RedisError:
            logger.exception("redis error in control listener, retrying in 5s")
            time.sleep(5)
        except Exception:
            logger.exception("unexpected control listener error, continuing")
            time.sleep(1)


def _setup_session(payload, stream_id, storage, work_root, fps, sessions) -> None:
    try:
        avatar_id = int(payload["avatarId"])
        work_dir = work_root / f"live-{stream_id}"
        if work_dir.exists():
            shutil.rmtree(work_dir, ignore_errors=True)
        work_dir.mkdir(parents=True)
        image_path = work_dir / ("image" + Path(payload["imageS3Key"]).suffix)
        storage.download(payload["imageS3Key"], image_path)
        audio_path = None
        if payload.get("voiceAudioS3Key"):
            audio_path = work_dir / ("voice" + Path(payload["voiceAudioS3Key"]).suffix)
            storage.download(payload["voiceAudioS3Key"], audio_path)

        session = LiveAvatarSession(
            avatar_id=avatar_id,
            stream_id=stream_id,
            image_path=image_path,
            audio_path=audio_path,
            work_dir=work_dir,
            fps=fps,
            queue_key=f"live_queue:{avatar_id}",
        )
        session.setup()
        sessions[avatar_id] = session
    except Exception:
        logger.exception("failed to set up live session for %s", payload.get("streamId"))


def main() -> None:
    _load_local_env()
    _check_required_env()
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

    def _shutdown(*_args):
        logger.info("shutting down %d live session(s)", len(sessions))
        for session in sessions.values():
            session.close()
        raise SystemExit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    logger.info("stream worker started: control=%s fps=%s", control_key, fps)

    while True:
        try:
            for session in list(sessions.values()):
                if session.ready:
                    session.tick(r)
            if not sessions:
                time.sleep(0.2)
        except Exception:
            logger.exception("unexpected stream worker error, continuing")
            time.sleep(1)


if __name__ == "__main__":
    main()
