"""Audio-driven lip sync via Wav2Lip.

Wav2Lip takes a silent talking-head video plus a speech WAV and replaces the
mouth region frame by frame so it matches the audio. This class wraps the
official PyTorch implementation (Rudrabha/Wav2Lip) with a modern-torch
compatible loader.

Device strategy: prefer MPS on Apple Silicon, fall back to CPU automatically.
Face detection always runs on CPU for maximum compatibility; only the Wav2Lip
model itself is placed on MPS/CUDA.
"""

import logging
import os
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
import torch

from hardware import detect_device

logger = logging.getLogger(__name__)

WORKER_ROOT = Path(__file__).resolve().parent.parent

MEL_STEP_SIZE = 16
IMG_SIZE = 96
# Wav2Lip mel-spectrogram parameters (must match the trained model).
SAMPLE_RATE = 16000
N_FFT = 800
HOP_SIZE = 200
WIN_SIZE = 800
N_MELS = 80
FMIN = 55
FMAX = 7600


class Wav2LipLipSync:
    """Replace the mouth region of a base video with audio-driven lip motion."""

    def __init__(
        self,
        repo_dir: Path | None = None,
        models_dir: Path | None = None,
        checkpoint: Path | None = None,
        s3fd_path: Path | None = None,
        device: str | None = None,
        wav2lip_batch_size: int = 32,
        face_det_batch_size: int = 16,
        pads: tuple = (0, 10, 0, 0),
        fps: float | None = None,
    ):
        self.repo_dir = repo_dir or Path(
            os.environ.get("WAV2LIP_REPO", WORKER_ROOT / "external" / "Wav2Lip")
        )
        self.models_dir = models_dir or Path(
            os.environ.get("WAV2LIP_MODELS_DIR", WORKER_ROOT / "models" / "wav2lip")
        )
        self.checkpoint = Path(
            checkpoint
            or os.environ.get("WAV2LIP_CHECKPOINT")
            or self._resolve_weight("wav2lip_gan.pth")
        )
        self.s3fd_path = Path(
            s3fd_path
            or os.environ.get("WAV2LIP_S3FD")
            or self._resolve_weight("s3fd-619a316812.pth")
        )
        self.device = device or os.environ.get("WAV2LIP_DEVICE") or detect_device()
        self.wav2lip_batch_size = wav2lip_batch_size
        self.face_det_batch_size = face_det_batch_size
        self.pads = tuple(pads)
        self.fps = fps
        self._model = None
        self._model_device = None

    def _resolve_weight(self, name: str) -> Path:
        """Accept weights under models/wav2lip/checkpoints/ or models/wav2lip/."""
        for base in (self.models_dir / "checkpoints", self.models_dir):
            candidate = base / name
            if candidate.exists():
                return candidate
        return self.models_dir / "checkpoints" / name

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
        self._prepare_repo()

        frames, video_fps = self._read_frames(base_video)
        fps = self.fps or video_fps or 25.0
        logger.info("Wav2Lip: %s frames @ %.2f fps", len(frames), fps)

        mel_chunks = self._mel_chunks(tts_wav, fps)
        logger.info("Wav2Lip: %s mel chunks from %s", len(mel_chunks), tts_wav.name)
        frames = frames[: len(mel_chunks)]
        if not frames:
            raise RuntimeError("Wav2Lip: no video frames to process")

        model = self._load_model()
        device = self._model_device
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
                self._run_batch(
                    model, device, img_batch, mel_batch, frame_batch, coords_batch, writer
                )
                img_batch, mel_batch, frame_batch, coords_batch = [], [], [], []

        if img_batch:
            self._run_batch(
                model, device, img_batch, mel_batch, frame_batch, coords_batch, writer
            )
        writer.release()

        final = work_dir / "final_avatar.mp4"
        self._mux_audio(raw_video, tts_wav, final)
        logger.info("Wav2Lip wrote %s", final)
        return final

    # ------------------------------------------------------------------ #
    # Inference internals (mirrors the official inference.py)
    # ------------------------------------------------------------------ #
    def _run_batch(self, model, device, img_batch, mel_batch, frame_batch, coords_batch, writer) -> None:
        img_batch = np.asarray(img_batch)
        mel_batch = np.asarray(mel_batch)

        img_masked = img_batch.copy()
        img_masked[:, IMG_SIZE // 2 :] = 0
        img_batch = np.concatenate((img_masked, img_batch), axis=3) / 255.0
        mel_batch = np.reshape(mel_batch, [len(mel_batch), mel_batch.shape[1], mel_batch.shape[2], 1])

        img_t = torch.FloatTensor(np.transpose(img_batch, (0, 3, 1, 2))).to(device)
        mel_t = torch.FloatTensor(np.transpose(mel_batch, (0, 3, 1, 2))).to(device)

        with torch.no_grad():
            pred = model(mel_t, img_t)

        pred = pred.cpu().numpy().transpose(0, 2, 3, 1) * 255.0
        for p, f, c in zip(pred, frame_batch, coords_batch):
            y1, y2, x1, x2 = c
            p = cv2.resize(p.astype(np.uint8), (x2 - x1, y2 - y1))
            f[y1:y2, x1:x2] = p
            writer.write(f)

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
        import librosa

        wav, _ = librosa.load(str(wav_path), sr=SAMPLE_RATE, mono=True)
        mel = librosa.feature.melspectrogram(
            y=wav,
            sr=SAMPLE_RATE,
            n_fft=N_FFT,
            hop_length=HOP_SIZE,
            win_length=WIN_SIZE,
            n_mels=N_MELS,
            fmin=FMIN,
            fmax=FMAX,
        )
        mel = librosa.power_to_db(mel, ref=np.max)
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
        import face_detection

        det_device = "cuda" if self._model_device == "cuda" else "cpu"
        detector = face_detection.FaceAlignment(
            face_detection.LandmarksType._2D, flip_input=False, device=det_device
        )
        predictions = []
        for i in range(0, len(frames), self.face_det_batch_size):
            predictions.extend(
                detector.get_detections_for_batch(np.array(frames[i : i + self.face_det_batch_size]))
            )

        pady1, pady2, padx1, padx2 = self.pads
        results = []
        for rect, image in zip(predictions, frames):
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
        return [
            [frames[i][y1:y2, x1:x2], (y1, y2, x1, x2)]
            for i, (x1, y1, x2, y2) in enumerate(boxes)
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
    # Model / repo management
    # ------------------------------------------------------------------ #
    def _load_model(self):
        if self._model is not None:
            return self._model

        sys.path.insert(0, str(self.repo_dir))
        from models.wav2lip import Wav2Lip

        attempts = ["cpu"]
        if self.device != "cpu":
            attempts.insert(0, self.device)

        last_err: Exception | None = None
        for dev in attempts:
            try:
                model = Wav2Lip()
                state = torch.load(
                    str(self.checkpoint), map_location=dev, weights_only=False
                )["state_dict"]
                new_s = {k.replace("module.", ""): v for k, v in state.items()}
                model.load_state_dict(new_s)
                model.to(dev).eval()
                # Sanity forward pass to catch unsupported ops early.
                with torch.no_grad():
                    model(
                        torch.zeros(1, 1, N_MELS, MEL_STEP_SIZE, device=dev),
                        torch.zeros(1, 6, IMG_SIZE, IMG_SIZE, device=dev),
                    )
                self._model = model
                self._model_device = dev
                logger.info("Wav2Lip model loaded on %s", dev)
                return model
            except Exception as exc:
                last_err = exc
                logger.warning("Wav2Lip failed on device %s: %s", dev, exc)

        raise RuntimeError(f"Wav2Lip could not run on any device: {last_err}")

    def _prepare_repo(self) -> None:
        target = self.repo_dir / "face_detection" / "detection" / "sfd" / "s3fd.pth"
        if not target.exists() and self.s3fd_path.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            target.symlink_to(self.s3fd_path.resolve())
        if not target.exists():
            raise RuntimeError(
                "Wav2Lip face detector weights (s3fd) are missing at "
                f"{target}\nDownload them with:\n"
                "  cd worker && uv run python download_models.py --models wav2lip"
            )

    def _check_models(self) -> None:
        missing = [
            str(p)
            for p in (self.checkpoint, self.s3fd_path)
            if not Path(p).exists()
        ]
        if missing:
            raise RuntimeError(
                "Wav2Lip model weights are missing:\n  "
                + "\n  ".join(missing)
                + "\n\nDownload them with:\n"
                "  cd worker && uv run python download_models.py --models wav2lip"
            )

    @staticmethod
    def _mux_audio(video: Path, wav: Path, final: Path) -> None:
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(video),
            "-i", str(wav),
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "128k",
            "-shortest",
            str(final),
        ]
        subprocess.run(cmd, check=True, capture_output=True, text=True)
