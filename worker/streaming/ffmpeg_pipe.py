"""FFmpeg subprocess pipe: raw BGR frames + 16k PCM audio -> RTMP/FLV.

The worker renders lip-synced frames in memory (Wav2Lip) and must push them
to SRS without writing an MP4. We start a single ffmpeg process with two
inputs:

  - video: `-f rawvideo -pix_fmt bgr24 -s WxH -r FPS -i pipe:0` (stdin)
  - audio: `-f s16le -ar 16000 -ac 1 -i <fifo_path>` (named FIFO)

Using a named FIFO for audio avoids fd-inheritance issues in Docker
containers where /dev/fd and pass_fds semantics may differ. Python opens
the write end of the FIFO after ffmpeg opens the read end (the open() on
both sides unblocks each other).

Two rules avoid pipe deadlocks:

  - ffmpeg waits for the first packet of EVERY input before consuming, so
    the first audio slice must be written before the first video frame.
  - a whole chunk of audio written at once overflows ffmpeg's pre-video
    input buffering and blocks; audio must be interleaved with video in
    small slices (the stream worker writes half-second slices every
    fps/2 frames).

The muxer assigns timestamps from consumed frames/samples, so interleaving
order does not affect A/V sync.
"""

import logging
import os
import subprocess
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

AUDIO_SAMPLE_RATE = 16000
_AUDIO_WRITE_CHUNK = 4096


class FFmpegPipeClosedError(OSError):
    """Raised when writing to a pipe whose ffmpeg process has exited."""


class FFmpegPipe:
    """A single ffmpeg process encoding BGR24 frames + s16le PCM to an
    RTMP/FLV destination (SRS or a local file for testing)."""

    def __init__(
        self,
        stream_id: str,
        width: int,
        height: int,
        fps: float,
        rtmp_url: str | None = None,
        ffmpeg_bin: str = "ffmpeg",
        log_path: Path | None = None,
    ):
        self.stream_id = stream_id
        self.width = width
        self.height = height
        self.fps = float(fps)
        self.rtmp_url = rtmp_url or os.environ.get(
            "STREAM_RTMP_URL", "rtmp://localhost:1935/live/{stream_id}"
        ).format(stream_id=stream_id)
        self.ffmpeg_bin = ffmpeg_bin
        self.log_path = log_path or Path(
            os.environ.get("STREAM_FFMPEG_LOG", f"/tmp/ffmpeg_{stream_id}.log")
        )
        self.proc: subprocess.Popen | None = None
        self._audio_fifo: str | None = None       # path to named FIFO
        self._audio_fh: "typing.BinaryIO | None" = None  # write end
        self._stderr_thread: threading.Thread | None = None

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #
    def start(self) -> None:
        """Launch ffmpeg. Video arrives on stdin; audio via a named FIFO."""
        if self.proc is not None:
            return

        import typing

        # Create a named FIFO for audio; ffmpeg opens it as a regular path,
        # avoiding all fd-inheritance issues inside Docker containers.
        fifo_dir = Path(f"/tmp/talking-avatar-worker/live-{self.stream_id}")
        fifo_dir.mkdir(parents=True, exist_ok=True)
        fifo_path = str(fifo_dir / "audio.fifo")
        try:
            os.remove(fifo_path)
        except FileNotFoundError:
            pass
        os.mkfifo(fifo_path)
        self._audio_fifo = fifo_path

        cmd = [
            self.ffmpeg_bin,
            "-y",
            "-loglevel", "warning",
            "-thread_queue_size", "512",
            "-probesize", "32",
            "-analyzeduration", "0",
            "-f", "rawvideo",
            "-pix_fmt", "bgr24",
            "-s", f"{self.width}x{self.height}",
            "-r", str(self.fps),
            "-i", "pipe:0",
            "-thread_queue_size", "512",
            "-probesize", "32",
            "-analyzeduration", "0",
            "-f", "s16le",
            "-ar", str(AUDIO_SAMPLE_RATE),
            "-ac", "1",
            "-i", fifo_path,
        ]
        cmd += [
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-tune", "zerolatency",
            "-pix_fmt", "yuv420p",
            "-g", str(max(2, int(self.fps * 2))),
            "-c:a", "aac",
            "-b:a", "128k",
            "-ar", "44100",
            "-flush_packets", "1",
            "-f", "flv",
            self.rtmp_url,
        ]
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

        # Drain stderr in background so it never blocks ffmpeg, and log it.
        def _drain_stderr():
            assert self.proc is not None
            for line in self.proc.stderr:  # type: ignore[union-attr]
                decoded = line.decode(errors="replace").rstrip()
                if decoded:
                    logger.warning("[ffmpeg:%s] %s", self.stream_id, decoded)

        self._stderr_thread = threading.Thread(
            target=_drain_stderr, daemon=True, name=f"ffmpeg-stderr-{self.stream_id}"
        )
        self._stderr_thread.start()

        # Open the FIFO write end in a background thread — open() on a FIFO
        # blocks until the reader (ffmpeg) also opens it, so we must not block
        # the caller. Once ffmpeg has opened the read end, the open() returns.
        def _open_fifo():
            try:
                fh = open(fifo_path, "wb", buffering=0)
                self._audio_fh = fh
                logger.info(
                    "ffmpeg pipe started for stream %s -> %s",
                    self.stream_id,
                    self.rtmp_url,
                )
            except Exception as exc:
                logger.error("failed to open audio FIFO for %s: %s", self.stream_id, exc)

        fifo_thread = threading.Thread(
            target=_open_fifo, daemon=True, name=f"fifo-open-{self.stream_id}"
        )
        fifo_thread.start()

        logger.info(
            "ffmpeg launching for stream %s -> %s (audio FIFO: %s)",
            self.stream_id,
            self.rtmp_url,
            fifo_path,
        )

    # ------------------------------------------------------------------ #
    # Writing
    # ------------------------------------------------------------------ #
    def _check_alive(self) -> None:
        if self.proc is None:
            raise FFmpegPipeClosedError(
                f"ffmpeg pipe for stream {self.stream_id} was never started"
            )
        code = self.proc.poll()
        if code is not None:
            raise FFmpegPipeClosedError(
                f"ffmpeg exited with code {code} for stream {self.stream_id} "
                f"(see {self.log_path})"
            )

    def write_frame(self, bgr_frame) -> None:
        """Write one BGR24 frame (OpenCV ndarray, HxWx3 uint8)."""
        self._check_alive()
        try:
            self.proc.stdin.write(bgr_frame.tobytes())  # type: ignore[union-attr]
            self.proc.stdin.flush()  # type: ignore[union-attr]
        except (BrokenPipeError, OSError) as exc:
            raise FFmpegPipeClosedError(
                f"video pipe closed for stream {self.stream_id} "
                f"(ffmpeg log: {self.log_path})"
            ) from exc

    def write_audio(self, pcm16_bytes: bytes) -> None:
        """Write mono 16kHz s16le PCM."""
        self._check_alive()
        # Wait for the FIFO to be opened by the background thread.
        import time
        while self._audio_fh is None:
            self._check_alive()
            time.sleep(0.01)
        fh = self._audio_fh
        try:
            view = memoryview(pcm16_bytes)
            pos = 0
            while pos < len(view):
                written = fh.write(view[pos : pos + _AUDIO_WRITE_CHUNK])  # type: ignore[arg-type]
                if not written:
                    raise OSError("ffmpeg audio FIFO closed early")
                pos += written
        except (BrokenPipeError, OSError) as exc:
            raise FFmpegPipeClosedError(
                f"audio FIFO closed for stream {self.stream_id} "
                f"(ffmpeg log: {self.log_path})"
            ) from exc

    # ------------------------------------------------------------------ #
    # Teardown
    # ------------------------------------------------------------------ #
    def stop(self, timeout: float = 10.0) -> int:
        """Close both inputs and wait for ffmpeg to finish; returns exit code."""
        code = 1
        try:
            if self.proc is not None and self.proc.stdin:
                self.proc.stdin.close()
            if self._audio_fh is not None:
                try:
                    self._audio_fh.close()
                except OSError:
                    pass
                self._audio_fh = None
            if self._audio_fifo is not None:
                try:
                    os.remove(self._audio_fifo)
                except FileNotFoundError:
                    pass
                self._audio_fifo = None
            if self.proc is not None:
                code = self.proc.wait(timeout=timeout)
                if code != 0:
                    logger.error(
                        "ffmpeg exited with %s for stream %s (see %s)",
                        code,
                        self.stream_id,
                        self.log_path,
                    )
        finally:
            self.proc = None
            self._audio_fh = None
        return code
