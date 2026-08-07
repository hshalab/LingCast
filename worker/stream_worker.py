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

Audio is written in aligned 0.5s slices (16kHz s16le mono = 16000 bytes), the
same interleaving pattern the pre-Watchdog pipeline used: the first 0.5s of a
talking segment is pre-buffered before its first frame, then one 0.5s slice is
written every `fps/2` frames. This gives the AAC encoder enough runway that
writer-thread jitter cannot cause underruns/clicks, while per-frame slices
could. Idle silence uses the same 0.5s slice cadence.

Face restoration (GFPGAN/CodeFormer) is intentionally OFF in the live pipeline:
it is ~1s/frame on Apple Silicon CoreML and cannot sustain 24fps.
"""

import json
import logging
import os
import queue as queue_mod
import random
import requests
import shutil
import signal
import subprocess
import sys
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

# Seconds of busy-wait at the end of each frame slot: time.sleep() alone
# overshoots by the GIL switch interval (~5ms by default), which drops the
# watchdog from 24fps to ~21.5fps and makes the player buffer. Sleeping the
# bulk then spinning the last few ms holds the deadline precisely.
PACING_BUSY_TAIL = 0.004


def parse_live_message(raw: str) -> tuple[str, str | None]:
    """Parse one live_queue entry into (text, tts_s3_key).

    The queue carries plain-text sentences (the legacy/current producer) or
    JSON messages from the S3-shared-storage architecture:
        {"text": "...", "tts_s3_key": "tts/xxx.wav", "base_video_s3_key": "..."}
    The `base_video_s3_key` is ignored here — the live session already owns
    its base clip; only the TTS key (optional) is acted upon.
    """
    raw = (raw or "").strip()
    if not raw:
        return "", None
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            text = str(obj.get("text") or obj.get("content") or "")
            tts_key = str(obj.get("tts_s3_key") or "").strip() or None
            return text, tts_key
    except (json.JSONDecodeError, TypeError):
        pass
    return raw, None


class _TalkingSegment:
    """One lip-synced sentence waiting in the ready-frames queue."""

    __slots__ = ("text", "audio", "total_frames", "frames_written", "pos")

    def __init__(self, text: str, audio: bytes, total_frames: int):
        self.text = text
        self.audio = audio
        self.total_frames = total_frames
        self.frames_written = 0
        self.pos = 0

    def next_slice(self, bytes_per_slice: int) -> bytes:
        """Next sequential audio slice (0.5s chunks), empty when exhausted."""
        end = min(self.pos + bytes_per_slice, len(self.audio))
        if self.pos >= len(self.audio):
            return b""
        seg = self.audio[self.pos : end]
        self.pos = end
        return seg


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
        storage: S3Storage | None = None,
        idle_video_paths: list[Path] | None = None,
        idle_switch_mode: str = "interval",
        idle_switch_seconds: int = 15,
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
        self.storage = storage
        self.idle_video_paths = idle_video_paths or []
        self.idle_switch_mode = idle_switch_mode or "interval"
        self.idle_switch_seconds = max(1, int(idle_switch_seconds or 15))
        self.pipe = None
        self.base_frames: list | None = None
        # Idle clips: every pre-processed driving video pushed while the
        # avatar is not talking; the worker switches between them (interval or
        # random) so the default stream picture is not a single fixed loop.
        self.idle_clips: list[list] = []
        self._idle_clip_idx = 0
        self._idle_frame_idx = 0
        self._idle_elapsed_frames = 0
        self._idle_switch_frames = max(1, int(self.idle_switch_seconds * self.fps))
        # Clip the current talking segment was lip-synced from (and where it
        # ended inside that clip), so idle resumes seamlessly on speech end.
        self._talk_base_clip = 0
        self._talk_base_end = 0
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
        # Profiling/health telemetry (diagnostics only; does not affect pacing).
        self._last_health_log = 0.0
        self._last_watchdog_warn = 0.0
        self._last_write_warn = 0.0

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
        # Optional face restoration fixes Wav2Lip lip deformation (口型变形).
        # Live follows the same FACE_ENHANCER env as offline
        # (gfpgan|codeformer|off); the auto default stays disabled because
        # full restoration is ~1s/frame and would stall the 24fps watchdog.
        # ENHANCER_MAX_FPS throttles how many frames are enhanced (e.g. 6 =
        # every ~4th frame), keeping the producer ahead of real-time.
        from ai.enhancer import create_enhancer

        self.enhancer = create_enhancer(pipeline="live")
        if self.enhancer is not None:
            self.lipsync.enhancer = self.enhancer
            logger.info("live pipeline face enhancer: %s", self.enhancer.kind)
        self.base_frames, base_fps = Wav2LipOnnxLipSync._read_frames(self.base_video_path)
        # Idle clips: the base video plus any additional scene videos of the
        # configured idle scene. Clips must match the base resolution so the
        # same ffmpeg pipe can play them all; mismatched ones are skipped.
        self.idle_clips = [self.base_frames]
        for p in self.idle_video_paths:
            try:
                if not p.exists():
                    logger.warning("idle video not found: %s", p)
                    continue
                frames, _ = Wav2LipOnnxLipSync._read_frames(p)
                if not frames:
                    continue
                if frames[0].shape[:2] != self.base_frames[0].shape[:2]:
                    logger.warning(
                        "skip idle video %s: shape %s != base shape %s",
                        p,
                        frames[0].shape[:2],
                        self.base_frames[0].shape[:2],
                    )
                    continue
                self.idle_clips.append(frames)
            except Exception:
                logger.exception("failed to load idle video %s", p)
        if len(self.idle_clips) > 1:
            logger.info(
                "avatar %s idle clips: %d videos, mode=%s, switch every %ds",
                self.avatar_id,
                len(self.idle_clips),
                self.idle_switch_mode,
                self.idle_switch_seconds,
            )
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
    def maybe_start_tts(self, text: str, tts_s3_key: str | None = None) -> bool:
        """Kick off a producer-side TTS job (synthesize or S3 download)."""
        if self._tts_thread is not None and self._tts_thread.is_alive():
            return False
        self._tts_thread = threading.Thread(
            target=self._run_tts,
            args=(text, tts_s3_key),
            daemon=True,
            name=f"tts-{self.stream_id}",
        )
        self._tts_thread.start()
        return True

    def _run_tts(self, text: str, tts_s3_key: str | None = None) -> None:
        """Synthesize locally or download a shared TTS wav from S3.

        Runs on the TTS thread (producer side) so the network I/O can never
        block the watchdog writer thread. The resulting wav is handed to the
        frame producer, which removes it once Wav2Lip has consumed it.
        """
        try:
            out = self.work_dir / f"chunk_{int(time.time() * 1000)}.wav"
            if tts_s3_key:
                if self.storage is None:
                    raise RuntimeError(
                        "tts_s3_key provided but session has no S3 storage"
                    )
                t_dl = time.perf_counter()
                self.storage.download(tts_s3_key, out)
                logger.info(
                    "[PRODUCER] avatar %s S3 Download took %.1fms (%s)",
                    self.avatar_id,
                    (time.perf_counter() - t_dl) * 1000.0,
                    tts_s3_key,
                )
                logger.info(
                    "avatar %s TTS downloaded from S3: %s",
                    self.avatar_id,
                    tts_s3_key,
                )
            else:
                t_syn = time.perf_counter()
                self._get_tts().synthesize(text, None, out)
                logger.info(
                    "[PRODUCER] avatar %s edge-tts synthesize took %.1fms",
                    self.avatar_id,
                    (time.perf_counter() - t_syn) * 1000.0,
                )
            wav = out
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
        half_sec_bytes = AUDIO_SAMPLE_RATE * 2 // 2
        half_sec_frames = max(1, int(round(self.fps / 2)))
        silence_slice = b"\x00\x00" * (half_sec_bytes // 2)
        idle_count = 0
        cur_seg: _TalkingSegment | None = None
        next_tick = time.perf_counter()
        logger.info("avatar %s watchdog writer started @ %.3fs/frame", self.avatar_id, interval)
        try:
            while self._running:
                next_tick += interval
                # After a long stall (ffmpeg backpressure), resync instead of
                # bursting missed frames into a still-congested pipe.
                if next_tick < time.perf_counter() - interval:
                    next_tick = time.perf_counter()
                t0 = time.perf_counter()

                # Probe: how long does the ready-frame queue block us?
                t_get = time.perf_counter()
                try:
                    kind, payload = self._talk_queue.get_nowait()
                except queue_mod.Empty:
                    kind, payload = None, None
                get_ms = (time.perf_counter() - t_get) * 1000.0

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
                    # Pre-buffer the first 0.5s of audio before the first frame
                    # (ffmpeg waits for every input's first packet; this also
                    # gives the AAC encoder runway against writer jitter).
                    if cur_seg.frames_written == 0:
                        pre = cur_seg.next_slice(half_sec_bytes)
                        if pre:
                            self.pipe.write_audio(pre)
                    # Write the periodic audio slice BEFORE this frame: video
                    # frames are ~2.7MB at 720x1280 and the pipe write can
                    # block on ffmpeg backpressure for tens of ms. Writing
                    # audio first means encoder starvation can never be caused
                    # by a slow video write.
                    if (
                        cur_seg.frames_written > 0
                        and cur_seg.frames_written % half_sec_frames == 0
                        and cur_seg.pos < len(cur_seg.audio)
                    ):
                        audio = cur_seg.next_slice(half_sec_bytes)
                        if audio:
                            self.pipe.write_audio(audio)
                    self._write_frame(payload)
                    cur_seg.frames_written += 1
                    if cur_seg.frames_written >= cur_seg.total_frames:
                        if cur_seg.pos < len(cur_seg.audio):
                            self.pipe.write_audio(cur_seg.audio[cur_seg.pos :])
                        cur_seg = None
                        self._subtitle_text = ""
                        # Resume idle from the clip that was actually speaking
                        # (mouth moves on the same video that was on screen),
                        # continuing where the talking loop left off.
                        self._idle_clip_idx = self._talk_base_clip
                        self._idle_frame_idx = self._talk_base_end
                        self._idle_elapsed_frames = 0
                else:
                    # Idle fallback: base animation + silence, never blocking.
                    idle_count += 1
                    if idle_count % half_sec_frames == 1:
                        self.pipe.write_audio(silence_slice)
                    self._write_frame(self._idle_frame())

                # Probe: actual work (pipe writes + subtitle overlay) and the
                # real sleep; a loop over 45ms means we miss the 24fps cadence.
                elapsed_work = time.perf_counter() - t0  # seconds, incl. queue get
                work_ms = elapsed_work * 1000.0 - get_ms
                # Pace to the deadline: sleep the bulk, busy-wait the tail.
                delay = next_tick - time.perf_counter()
                sleep_ms = 0.0
                if delay > PACING_BUSY_TAIL:
                    t_sleep = time.perf_counter()
                    time.sleep(delay - PACING_BUSY_TAIL)
                    sleep_ms = (time.perf_counter() - t_sleep) * 1000.0
                while time.perf_counter() < next_tick:
                    pass
                total_ms = (time.perf_counter() - t0) * 1000.0
                if total_ms > 45.0 and time.monotonic() - self._last_watchdog_warn >= 1.0:
                    self._last_watchdog_warn = time.monotonic()
                    logger.warning(
                        "[WATCHDOG WARNING] avatar %s loop took %.1fms (>45ms)! "
                        "queue_get=%.1fms write/work=%.1fms sleep=%.1fms",
                        self.avatar_id,
                        total_ms,
                        get_ms,
                        work_ms,
                        sleep_ms,
                    )
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
        clips = self.idle_clips or [self.base_frames]
        clip = clips[self._idle_clip_idx % len(clips)]
        frame = clip[self._idle_frame_idx % len(clip)]
        self._idle_frame_idx += 1
        self._idle_elapsed_frames += 1
        if len(clips) > 1 and self._idle_elapsed_frames >= self._idle_switch_frames:
            self._switch_idle_clip()
        return frame

    def _switch_idle_clip(self) -> None:
        """Switch to the next (interval) or a random (random) idle clip and
        schedule the next switch: fixed N seconds, or a random 5-30s window."""
        n = len(self.idle_clips)
        if n <= 1:
            self._idle_elapsed_frames = 0
            return
        if self.idle_switch_mode == "random":
            candidates = [i for i in range(n) if i != self._idle_clip_idx] or [0]
            self._idle_clip_idx = random.choice(candidates)
            lo = max(5, self.idle_switch_seconds // 2)
            hi = max(30, self.idle_switch_seconds * 2)
            self._idle_switch_frames = max(
                1, random.randint(int(lo * self.fps), int(hi * self.fps))
            )
            logger.info(
                "avatar %s idle -> random clip %d/%d (next switch in %.1fs)",
                self.avatar_id,
                self._idle_clip_idx + 1,
                n,
                self._idle_switch_frames / self.fps,
            )
        else:
            self._idle_clip_idx = (self._idle_clip_idx + 1) % n
            self._idle_switch_frames = max(
                1, int(self.idle_switch_seconds * self.fps)
            )
            logger.info(
                "avatar %s idle -> clip %d/%d (switch every %ds)",
                self.avatar_id,
                self._idle_clip_idx + 1,
                n,
                self.idle_switch_seconds,
            )
        self._idle_frame_idx = 0
        self._idle_elapsed_frames = 0

    # ------------------------------------------------------------------ #
    # Queue management loop (lightweight; no pipe I/O)
    # ------------------------------------------------------------------ #
    def tick(self, r: redis.Redis) -> None:
        """Pop text, hand finished TTS to the producer, keep queues fed."""
        # 0) Every 5s: queue health + process CPU (diagnostics only).
        now = time.monotonic()
        if now - self._last_health_log >= 5.0:
            self._last_health_log = now
            cpu: float | None = None
            try:
                import psutil

                cpu = psutil.Process().cpu_percent(interval=None)
            except Exception:
                pass
            logger.info(
                "[HEALTH] avatar %s ready_frames=%d pending=%d tts_results=%d "
                "tts_alive=%s cpu=%s%%",
                self.avatar_id,
                self._talk_queue.qsize(),
                self._pending.qsize(),
                self._tts_results.qsize(),
                self._tts_thread is not None and self._tts_thread.is_alive(),
                "%.1f" % cpu if cpu is not None else "n/a",
            )

        # 1) Pull new text when no TTS is in flight and pending has room.
        if (
            self._tts_thread is None or not self._tts_thread.is_alive()
        ) and not self._pending.full():
            raw = r.lpop(self.queue_key)
            if raw:
                text, tts_s3_key = parse_live_message(raw)
                if text or tts_s3_key:
                    self.maybe_start_tts(text, tts_s3_key)

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
            except redis.exceptions.ConnectionError:
                # Redis was restarted (e.g. the RedisStack switch): back off
                # quietly instead of spamming tracebacks every 0.2s. The pool
                # reconnects on the next successful tick.
                logger.warning(
                    "session %s redis connection lost, retrying in 1s",
                    self.stream_id,
                )
                time.sleep(1.0)
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
            # Probe: NumPy/SciPy audio + mel pre-processing (before ONNX).
            t_pre = time.perf_counter()
            audio = self.lipsync.audio_pcm16(wav)
            n_frames = len(self.lipsync._mel_chunks(wav, self.fps))
            seg = _TalkingSegment(text, audio, n_frames)
            self._talk_queue.put(("seg", seg))
            base_slice, _ = self._slice_current_idle(n_frames)
            pre_ms = (time.perf_counter() - t_pre) * 1000.0
            logger.info(
                "[PRODUCER] avatar %s preprocessing took %.1fms "
                "(audio+mel+base, %d frames)",
                self.avatar_id,
                pre_ms,
                n_frames,
            )

            # Probe: face detection + OpenCV pre-processing + ONNX inference,
            # broken down via the iter_frames timing hook.
            stage_ms: dict[str, float] = {}

            def _timing(stage: str, ms: float) -> None:
                stage_ms[stage] = stage_ms.get(stage, 0.0) + ms

            t_inf = time.perf_counter()
            frames = self.lipsync.iter_frames(
                wav, base_slice, self.fps, timing=_timing
            )
            pushed = 0
            for frame in frames:
                self._talk_queue.put(("frame", frame))
                pushed += 1
            inf_ms = (time.perf_counter() - t_inf) * 1000.0
            logger.info(
                "[PRODUCER] avatar %s Wav2Lip Inference took %.1fms "
                "for %d frames (face_detect=%.1fms opencv_preprocess=%.1fms "
                "onnx=%.1fms)",
                self.avatar_id,
                inf_ms,
                pushed,
                stage_ms.get("face_detect", 0.0),
                stage_ms.get("preprocess", 0.0),
                stage_ms.get("onnx_batch", 0.0),
            )
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
        finally:
            # Zero-leak: the TTS wav (S3-downloaded or locally synthesized)
            # is removed as soon as Wav2Lip has consumed it.
            if isinstance(wav, Path):
                try:
                    wav.unlink(missing_ok=True)
                except OSError:
                    logger.warning("failed to remove temp tts file %s", wav)

    def _write_frame(self, frame) -> None:
        """Apply the subtitle overlay then push the frame into the pipe."""
        if self._subtitle_text and self._subtitle_enabled():
            if self._subtitle is None:
                from streaming.subtitle import SubtitleRenderer

                self._subtitle = self._make_subtitle_renderer()
            frame = self._subtitle.draw(frame, self._subtitle_text)
        t_write = time.perf_counter()
        self.pipe.write_frame(frame)
        write_ms = (time.perf_counter() - t_write) * 1000.0
        if write_ms > 20.0 and time.monotonic() - self._last_write_warn >= 5.0:
            self._last_write_warn = time.monotonic()
            logger.warning(
                "[WATCHDOG] avatar %s pipe.write_frame took %.1fms "
                "(ffmpeg backpressure?)",
                self.avatar_id,
                write_ms,
            )

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

    def _slice_current_idle(self, n: int) -> tuple[list, int]:
        """Slice the clip that is currently on screen (the idle clip the
        writer is pushing right now) as the Wav2Lip base, so the mouth moves
        on the same video the viewer sees — not always the default clip."""
        clips = self.idle_clips or [self.base_frames]
        idx = self._idle_clip_idx % len(clips)
        clip = clips[idx]
        start = self._idle_frame_idx % len(clip)
        seg = [clip[(start + k) % len(clip)] for k in range(n)]
        self._talk_base_clip = idx
        self._talk_base_end = (start + n) % len(clip)
        return seg, idx

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
        idle_keys = payload.get("idleVideos") or []
        if not idle_keys:
            idle_keys = [payload.get("baseVideoS3Key", "")]
        if not idle_keys[0]:
            logger.error(
                "control message for %s has no idle/base video; "
                "run the avatar pre-processing step first",
                stream_id,
            )
            return
        base_video_path = work_dir / "base_video.mp4"
        storage.download(idle_keys[0], base_video_path)
        idle_paths = []
        for i, key in enumerate(idle_keys[1:], start=1):
            p = work_dir / f"idle_{i}.mp4"
            try:
                storage.download(key, p)
                idle_paths.append(p)
            except Exception:
                logger.exception("failed to download idle video %s", key)
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
            storage=storage,
            idle_video_paths=idle_paths,
            idle_switch_mode=payload.get("idleSwitchMode") or "interval",
            idle_switch_seconds=int(payload.get("idleSwitchSeconds") or 15),
        )
        session.setup()
        sessions[avatar_id] = session
        session.start(r)
    except SystemExit:
        # Interpreter shutdown interrupted a mid-flight setup thread; this is
        # benign (the process is exiting anyway) — keep the log clean.
        pass
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
                    "idleVideos": item.get("idleVideos") or [],
                    "idleSwitchMode": item.get("idleSwitchMode") or "interval",
                    "idleSwitchSeconds": item.get("idleSwitchSeconds") or 15,
                    "voiceId": item.get("voiceId", ""),
                    "liveSettings": item.get("liveSettings") or {},
                }
                if not payload["imageS3Key"] or not payload["idleVideos"]:
                    logger.warning(
                        "session for avatar %s missing image/idle video keys, skip restore",
                        aid,
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
    # Reduce GIL handoff latency so the watchdog's time.sleep() reacquires the
    # GIL quickly and the 24fps deadline is met (default 5ms switch interval
    # alone drops the effective frame rate below 24fps).
    sys.setswitchinterval(0.001)
    # Diagnostics: STREAM_FAULTHANDLER=1 dumps all thread stacks to stderr
    # every 15s (used to catch silent hangs/deaths).
    if os.environ.get("STREAM_FAULTHANDLER"):
        import faulthandler

        faulthandler.dump_traceback_later(15, repeat=True)
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
