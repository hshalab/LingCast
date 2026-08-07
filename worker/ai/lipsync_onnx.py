"""Audio-driven lip sync via ONNX Wav2Lip (no torch at inference time).

Replaces the PyTorch Wav2Lip stage, which was pathologically slow on Apple
Silicon (MPS LSTM) and saturated every CPU core. The generator runs as a
converted `wav2lip_gan.onnx` and face detection uses SCRFD-2.5G ONNX, so both
steps execute through onnxruntime (CoreML EP preferred on macOS).

Model layout (created by download_models.py):
  worker/models/wav2lip/
    checkpoints/wav2lip_gan.onnx   # exported from wav2lip_gan.pth
    scrfd/scrfd_2.5g_bnkps.onnx    # face detector
"""

import logging
import os
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np

from .face_detect_onnx import ScrfdFaceDetector
from .onnx_utils import build_session

logger = logging.getLogger(__name__)

WORKER_ROOT = Path(__file__).resolve().parent.parent

MEL_STEP_SIZE = 16
IMG_SIZE = 96

# Wav2Lip mel-spectrogram parameters (must match the trained model exactly).
SAMPLE_RATE = 16000
N_FFT = 800
HOP_SIZE = 200
WIN_SIZE = 800
N_MELS = 80
FMIN = 55
FMAX = 7600
PREEMPHASIS = 0.97
REF_LEVEL_DB = 20.0
MIN_LEVEL_DB = -100.0
MAX_ABS_VALUE = 4.0


class Wav2LipOnnxLipSync:
    """Replace the mouth region of a base video with audio-driven lip motion."""

    def __init__(
        self,
        models_dir: Path | None = None,
        checkpoint: Path | None = None,
        scrfd_path: Path | None = None,
        enhancer=None,
        wav2lip_batch_size: int = 8,
        pads: tuple = (0, 10, 0, 0),
        fps: float | None = None,
        det_size: tuple[int, int] = (320, 320),
        face_sample_interval: int | None = None,
    ):
        self.models_dir = models_dir or Path(
            os.environ.get("WAV2LIP_MODELS_DIR", WORKER_ROOT / "models" / "wav2lip")
        )
        self.checkpoint = Path(
            checkpoint
            or os.environ.get("WAV2LIP_ONNX")
            or self.models_dir / "checkpoints" / "wav2lip_gan.onnx"
        )
        self.scrfd_path = Path(
            scrfd_path
            or os.environ.get("WAV2LIP_SCRFD")
            or self.models_dir / "scrfd" / "scrfd_2.5g_bnkps.onnx"
        )
        self.enhancer = enhancer
        self.wav2lip_batch_size = wav2lip_batch_size
        self.pads = tuple(pads)
        self.fps = fps
        self.det_size = det_size
        # LivePortrait avatars are near-static talking heads; running SCRFD on
        # every frame is wasteful. Detect every N frames and reuse the box
        # (with smoothing) for the frames in between. 1 disables sampling.
        self.face_sample_interval = (
            face_sample_interval
            if face_sample_interval is not None
            else int(os.environ.get("WAV2LIP_FACE_SAMPLE_INTERVAL", "5"))
        )
        self._session = None
        self._detector = None

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #
    def sync(self, tts_wav: Path, base_video: Path, work_dir: Path) -> Path:
        """Lip-sync `base_video` to `tts_wav` and write final_avatar.mp4."""
        tts_wav = Path(tts_wav)
        base_video = Path(base_video)
        if not tts_wav.exists():
            raise FileNotFoundError(f"TTS audio not found: {tts_wav}")
        if not base_video.exists():
            raise FileNotFoundError(f"base video not found: {base_video}")
        self._check_models()

        frames, video_fps = self._read_frames(base_video)
        fps = self.fps or video_fps or 25.0
        logger.info("Wav2Lip(onnx): %s frames @ %.2f fps", len(frames), fps)

        mel_chunks = self._mel_chunks(tts_wav, fps)
        logger.info("Wav2Lip(onnx): %s mel chunks from %s", len(mel_chunks), tts_wav.name)
        frames = frames[: len(mel_chunks)]
        if not frames:
            raise RuntimeError("Wav2Lip(onnx): no video frames to process")

        face_det_results = self._face_detect(frames)
        frame_h, frame_w = frames[0].shape[:2]

        raw_video = work_dir / "lipsync_raw.mp4"
        writer = cv2.VideoWriter(
            str(raw_video),
            cv2.VideoWriter_fourcc(*"mp4v"),
            fps,
            (frame_w, frame_h),
        )

        img_batch: list = []
        mel_batch: list = []
        frame_batch: list = []
        coords_batch: list = []
        total_batches = int(np.ceil(len(mel_chunks) / self.wav2lip_batch_size))
        batch_no = 0

        for i, m in enumerate(mel_chunks):
            idx = i % len(frames)
            frame_to_save = frames[idx].copy()
            face, coords = face_det_results[idx]
            face = cv2.resize(face, (IMG_SIZE, IMG_SIZE))
            img_batch.append(face)
            mel_batch.append(m)
            frame_batch.append(frame_to_save)
            coords_batch.append(coords)

            if len(img_batch) >= self.wav2lip_batch_size:
                batch_no += 1
                logger.info(
                    "Wav2Lip(onnx): inference batch %d/%d (%.0f%%)",
                    batch_no,
                    total_batches,
                    100.0 * batch_no / total_batches,
                )
                self._run_batch(
                    img_batch, mel_batch, frame_batch, coords_batch, writer
                )
                img_batch, mel_batch, frame_batch, coords_batch = [], [], [], []

        if img_batch:
            batch_no += 1
            logger.info("Wav2Lip(onnx): final batch %d/%d", batch_no, total_batches)
            self._run_batch(img_batch, mel_batch, frame_batch, coords_batch, writer)
        writer.release()

        final = work_dir / "final_avatar.mp4"
        self._mux_audio(raw_video, tts_wav, final)
        logger.info("Wav2Lip(onnx) wrote %s", final)
        return final

    # ------------------------------------------------------------------ #
    # Inference internals
    # ------------------------------------------------------------------ #
    def _run_batch(self, img_batch, mel_batch, frame_batch, coords_batch, writer) -> None:
        for frame in self._run_batch_frames(img_batch, mel_batch, frame_batch, coords_batch):
            writer.write(frame)

    def _run_batch_frames(
        self, img_batch, mel_batch, frame_batch, coords_batch, timing=None
    ) -> list:
        """Run one Wav2Lip inference batch and return the patched BGR frames.

        `timing(stage, ms)` is an optional diagnostics callback (profiling only;
        never changes inference behavior).
        """
        t0 = time.perf_counter()
        session = self._session or self._load_model()
        img_batch = np.asarray(img_batch)
        mel_batch = np.asarray(mel_batch)

        img_masked = img_batch.copy()
        img_masked[:, IMG_SIZE // 2 :] = 0
        img_batch = np.concatenate((img_masked, img_batch), axis=3) / 255.0
        mel_batch = np.reshape(mel_batch, [len(mel_batch), mel_batch.shape[1], mel_batch.shape[2], 1])

        feed = {
            "mel_spectrogram": np.transpose(mel_batch, (0, 3, 1, 2)).astype(np.float32),
            "video_frames": np.transpose(img_batch, (0, 3, 1, 2)).astype(np.float32),
        }
        pred = session.run(None, feed)[0]
        pred = pred.transpose(0, 2, 3, 1) * 255.0
        out_frames = []
        for p, f, c in zip(pred, frame_batch, coords_batch):
            y1, y2, x1, x2 = c
            p = cv2.resize(p.astype(np.uint8), (x2 - x1, y2 - y1))
            f[y1:y2, x1:x2] = p
            if self.enhancer is not None:
                f = self.enhancer.enhance_frame(f, (x1, y1, x2, y2))
            out_frames.append(f)
        if timing is not None:
            timing("onnx_batch", (time.perf_counter() - t0) * 1000.0)
        return out_frames

    def iter_frames(
        self,
        tts_wav: Path,
        base_frames: list,
        fps: float | None = None,
        timing=None,
    ):
        """Yield lip-synced BGR frames for `base_frames` + TTS audio (streaming).

        Unlike :meth:`sync`, nothing is written to disk: frames are generated
        in memory so the stream worker can pipe them straight into FFmpeg.
        """
        fps = fps or self.fps or 25.0
        self._check_models()
        mel_chunks = self._mel_chunks(tts_wav, fps)
        frames = list(base_frames[: len(mel_chunks)])
        if not frames:
            return
        t_fd = time.perf_counter()
        face_det_results = self._face_detect(frames)
        if timing is not None:
            timing("face_detect", (time.perf_counter() - t_fd) * 1000.0)

        img_batch, mel_batch, frame_batch, coords_batch = [], [], [], []
        for i, m in enumerate(mel_chunks):
            t_pre = time.perf_counter()
            idx = i % len(frames)
            face, coords = face_det_results[idx]
            img_batch.append(cv2.resize(face, (IMG_SIZE, IMG_SIZE)))
            mel_batch.append(m)
            frame_batch.append(frames[idx].copy())
            coords_batch.append(coords)
            if timing is not None:
                timing("preprocess", (time.perf_counter() - t_pre) * 1000.0)
            if len(img_batch) >= self.wav2lip_batch_size:
                yield from self._run_batch_frames(
                    img_batch, mel_batch, frame_batch, coords_batch, timing=timing
                )
                img_batch, mel_batch, frame_batch, coords_batch = [], [], [], []
        if img_batch:
            yield from self._run_batch_frames(
                img_batch, mel_batch, frame_batch, coords_batch, timing=timing
            )

    @staticmethod
    def audio_pcm16(tts_wav: Path) -> bytes:
        """Resample a TTS wav to 16kHz mono s16le for the FFmpeg audio pipe."""
        import librosa

        wav, _ = librosa.load(str(tts_wav), sr=SAMPLE_RATE, mono=True)
        return (np.clip(wav, -1.0, 1.0) * 32767.0).astype(np.int16).tobytes()

    def _load_model(self):
        if self._session is None:
            self._session = build_session(self.checkpoint)
            logger.info("Wav2Lip ONNX model loaded via %s", self._session.get_providers())
        return self._session

    # ------------------------------------------------------------------ #
    # Preprocessing
    # ------------------------------------------------------------------ #
    @staticmethod
    def _read_frames(video: Path) -> tuple[list, float]:
        cap = cv2.VideoCapture(str(video))
        fps = cap.get(cv2.CAP_PROP_FPS)
        frames = []
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(frame)
        cap.release()
        return frames, fps

    @staticmethod
    def _mel_chunks(wav_path: Path, fps: float) -> list[np.ndarray]:
        """Compute mel chunks exactly like the official Wav2Lip audio.py."""
        from scipy import signal as scipy_signal
        import librosa

        wav, _ = librosa.load(str(wav_path), sr=SAMPLE_RATE, mono=True)
        # Same preemphasis as Wav2Lip training.
        wav = scipy_signal.lfilter([1, -PREEMPHASIS], [1], wav)
        stft = librosa.stft(
            y=wav, n_fft=N_FFT, hop_length=HOP_SIZE, win_length=WIN_SIZE
        )
        mel_basis = librosa.filters.mel(
            sr=SAMPLE_RATE, n_fft=N_FFT, n_mels=N_MELS, fmin=FMIN, fmax=FMAX
        )
        amp = np.dot(mel_basis, np.abs(stft))
        min_level = np.exp(MIN_LEVEL_DB / 20.0 * np.log(10.0))
        db = 20.0 * np.log10(np.maximum(min_level, amp)) - REF_LEVEL_DB
        # Symmetric normalization to [-4, 4] (allow_clipping_in_normalization).
        mel = np.clip(
            (2.0 * MAX_ABS_VALUE) * ((db - MIN_LEVEL_DB) / (-MIN_LEVEL_DB)) - MAX_ABS_VALUE,
            -MAX_ABS_VALUE,
            MAX_ABS_VALUE,
        )
        if np.isnan(mel).sum() > 0:
            raise ValueError(
                "Wav2Lip: mel spectrogram contains NaN. "
                "The TTS audio may be silent or empty."
            )

        mel_idx_multiplier = 80.0 / fps
        chunks = []
        i = 0
        while True:
            start_idx = int(i * mel_idx_multiplier)
            if start_idx + MEL_STEP_SIZE > mel.shape[1]:
                chunks.append(mel[:, mel.shape[1] - MEL_STEP_SIZE :])
                break
            chunks.append(mel[:, start_idx : start_idx + MEL_STEP_SIZE])
            i += 1
        return chunks

    def _face_detect(self, frames: list) -> list:
        if self._detector is None:
            self._detector = ScrfdFaceDetector(
                self.scrfd_path, det_size=self.det_size
            )
        interval = max(1, self.face_sample_interval)
        sample_idx = list(range(0, len(frames), interval))
        sample_frames = [frames[i] for i in sample_idx]
        sample_boxes = self._detector.detect_batch(sample_frames)

        pady1, pady2, padx1, padx2 = self.pads
        results: list = []
        for rect, image in zip(sample_boxes, sample_frames):
            if rect is None:
                raise RuntimeError(
                    "Wav2Lip: face not detected in a base-video frame. "
                    "Make sure the avatar image contains a clear, frontal face."
                )
            y1 = max(0, int(rect[1]) - pady1)
            y2 = min(image.shape[0], int(rect[3]) + pady2)
            x1 = max(0, int(rect[0]) - padx1)
            x2 = min(image.shape[1], int(rect[2]) + padx2)
            results.append([x1, y1, x2, y2])

        boxes = np.array(results)
        boxes = self._smoothen_boxes(boxes, T=5)
        if interval > 1:
            logger.info(
                "Wav2Lip(onnx): face detection sampled every %d frames (%d/%d)",
                interval,
                len(sample_idx),
                len(frames),
            )
        return [
            [frames[i][y1:y2, x1:x2], (y1, y2, x1, x2)]
            for i, (x1, y1, x2, y2) in enumerate(
                boxes[i // interval] for i in range(len(frames))
            )
        ]

    @staticmethod
    def _smoothen_boxes(boxes: np.ndarray, T: int = 5) -> np.ndarray:
        for i in range(len(boxes)):
            if i + T > len(boxes):
                window = boxes[len(boxes) - T :]
            else:
                window = boxes[i : i + T]
            boxes[i] = np.mean(window, axis=0)
        return boxes

    # ------------------------------------------------------------------ #
    # Model management
    # ------------------------------------------------------------------ #
    def _check_models(self) -> None:
        missing = [
            str(p)
            for p in (self.checkpoint, self.scrfd_path)
            if not Path(p).exists()
        ]
        if missing:
            raise RuntimeError(
                "Wav2Lip ONNX model weights are missing:\n  "
                + "\n  ".join(missing)
                + "\n\nGenerate/download them with:\n"
                "  cd worker && uv run python download_models.py --models wav2lip"
            )

    @staticmethod
    def _mux_audio(video: Path, wav: Path, final: Path) -> None:
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(video),
            "-i", str(wav),
            "-map", "0:v:0", "-map", "1:a:0",
            # Re-encode to H.264: the raw Wav2Lip writer produces MPEG-4 Part 2
            # (mp4v) which browsers cannot decode (black screen in any player).
            "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k",
            "-shortest",
            str(final),
        ]
        subprocess.run(cmd, check=True, capture_output=True, text=True)
