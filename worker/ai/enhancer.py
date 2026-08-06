"""Face restoration enhancers that fix Wav2Lip lip deformation.

Wav2Lip is trained to force mouth motion, which often distorts the lower face
(chin warping, blurred edges, lost skin detail). Instead of retraining it, we
restore the face region with a separate restoration model:

  - GFPGAN (ONNX): fast ROI-based restoration used by the live streaming
    pipeline. Only the face bounding box is enhanced, then blended back with a
    feathered alpha mask (~80% less compute than full-frame restoration).
  - CodeFormer (ONNX): higher-fidelity full-face restoration used by the
    offline broadcast pipeline. Takes a configurable `fidelity_weight` (w)
    input that balances quality vs. identity preservation (default 0.6).

Both run through onnxruntime (CoreML on Apple Silicon, CUDA/ROCm on Linux),
matching the project's ONNX-first philosophy. If the checkpoint is missing the
enhancer degrades gracefully to a no-op with a warning, so the broadcast/live
pipeline never crashes because of an optional enhancement stage.

Model layout (created by download_models.py --models restoration):
  worker/models/restoration/
    gfpgan/GFPGANv1.4.onnx        # input "input"  [1,3,512,512] -> output 3ch
    codeformer/codeformer.onnx    # inputs "x" [B,3,512,512] + "w" (double)
"""

import logging
import os
from pathlib import Path

import cv2
import numpy as np

from .onnx_utils import build_session

logger = logging.getLogger(__name__)

WORKER_ROOT = Path(__file__).resolve().parent.parent
RESTORE_DIR = WORKER_ROOT / "models" / "restoration"

INPUT_SIZE = 512


def _feathered_mask(h: int, w: int, feather_ratio: float = 0.15) -> np.ndarray:
    """A 0..1 alpha mask that is opaque inside and fades near the edges."""
    mask = np.ones((h, w), dtype=np.float32)
    feather = max(1, int(feather_ratio * min(h, w)))
    ramp = np.linspace(0.0, 1.0, feather, dtype=np.float32)
    mask[:feather, :] *= ramp[:, None]
    mask[-feather:, :] *= ramp[::-1][:, None]
    mask[:, :feather] *= ramp[None, :]
    mask[:, -feather:] *= ramp[::-1][None, :]
    return mask


def _blend(frame: np.ndarray, restored: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Alpha-blend the restored ROI back into the original frame."""
    merged = (
        frame.astype(np.float32) * (1.0 - mask[..., None])
        + restored.astype(np.float32) * mask[..., None]
    )
    return np.clip(merged, 0, 255).astype(np.uint8)


class BaseEnhancer:
    """Unified face-enhancement interface.

    `face_box` is the standard (x1, y1, x2, y2) bounding box in frame pixel
    coordinates. Missing checkpoints disable the enhancer instead of failing.
    """

    kind = "base"

    def __init__(
        self,
        model_path: Path | None = None,
        roi_padding: float = 0.12,
        feather_ratio: float = 0.15,
        min_roi_size: int = 48,
    ):
        roi_padding = float(
            os.environ.get("ENHANCER_ROI_PADDING", str(roi_padding))
        )
        feather_ratio = float(
            os.environ.get("ENHANCER_FEATHER_RATIO", str(feather_ratio))
        )
        self.model_path = Path(
            model_path or os.environ.get("ENHANCER_MODEL", str(self.default_model_path()))
        )
        self.roi_padding = roi_padding
        self.feather_ratio = feather_ratio
        self.min_roi_size = min_roi_size
        self._session = None
        self.available = False

        if not self.model_path.exists():
            logger.warning(
                "%s model not found at %s — face enhancement disabled "
                "(run `uv run python download_models.py --models restoration`)",
                self.kind,
                self.model_path,
            )
            return
        try:
            self._session = build_session(
                self.model_path,
                threads_env="ENHANCER_THREADS",
                provider_env="ENHANCER_PROVIDER",
            )
            self.available = True
            logger.info(
                "%s enhancer loaded via %s",
                self.kind,
                self._session.get_providers(),
            )
        except Exception:
            logger.exception(
                "%s enhancer failed to load %s — disabled", self.kind, self.model_path
            )

    @classmethod
    def default_model_path(cls) -> Path:
        raise NotImplementedError

    def enhance_frame(
        self,
        frame: np.ndarray,
        face_box: tuple[int, int, int, int] | None = None,
    ) -> np.ndarray:
        """Restore the face ROI and blend it back with a feathered mask."""
        if not self.available or face_box is None:
            return frame
        x1, y1, x2, y2 = (int(v) for v in face_box)
        if x2 <= x1 or y2 <= y1:
            return frame

        h, w = frame.shape[:2]
        pad = int(max(self.roi_padding * (x2 - x1), self.roi_padding * (y2 - y1)))
        x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
        x2, y2 = min(w, x2 + pad), min(h, y2 + pad)
        roi_w, roi_h = x2 - x1, y2 - y1
        if min(roi_w, roi_h) < self.min_roi_size:
            return frame

        roi = frame[y1:y2, x1:x2]
        restored = self._restore_roi(roi)
        if restored is None:
            return frame
        restored = cv2.resize(restored, (roi_w, roi_h), interpolation=cv2.INTER_LINEAR)
        mask = _feathered_mask(roi_h, roi_w, self.feather_ratio)
        frame[y1:y2, x1:x2] = _blend(roi, restored, mask)
        return frame

    def _restore_roi(self, roi_bgr: np.ndarray) -> np.ndarray | None:
        """Run the restoration model on a BGR ROI and return the restored BGR."""
        raise NotImplementedError

    def close(self) -> None:
        self._session = None

    @staticmethod
    def _normalize(roi_bgr: np.ndarray) -> np.ndarray:
        rgb = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2RGB)
        resized = cv2.resize(rgb, (INPUT_SIZE, INPUT_SIZE), interpolation=cv2.INTER_AREA)
        blob = (resized.astype(np.float32) / 127.5 - 1.0).transpose(2, 0, 1)[None, ...]
        return np.ascontiguousarray(blob)

    @staticmethod
    def _denormalize(out: np.ndarray) -> np.ndarray:
        img = (out[0].transpose(1, 2, 0) + 1.0) * 127.5
        img = np.clip(img, 0, 255).astype(np.uint8)
        return cv2.cvtColor(img, cv2.COLOR_RGB2BGR)


class GFPGANEnhancer(BaseEnhancer):
    """GFPGANv1.4 (ONNX) — fast ROI restoration for live streaming."""

    kind = "gfpgan"

    @classmethod
    def default_model_path(cls) -> Path:
        return RESTORE_DIR / "gfpgan" / "GFPGANv1.4.onnx"

    def _restore_roi(self, roi_bgr: np.ndarray) -> np.ndarray | None:
        feed = {self._session.get_inputs()[0].name: self._normalize(roi_bgr)}
        out = self._session.run(None, feed)[0]
        return self._denormalize(out)


class CodeFormerEnhancer(BaseEnhancer):
    """CodeFormer (ONNX) — high-fidelity full-face restoration for offline.

    The exported model takes a `fidelity_weight` (double) input: lower values
    favor quality restoration, higher values keep the original identity.
    """

    kind = "codeformer"

    def __init__(
        self,
        model_path: Path | None = None,
        fidelity_weight: float = 0.6,
        **kwargs,
    ):
        self.fidelity_weight = float(
            os.environ.get("CODEFORMER_FIDELITY_WEIGHT", str(fidelity_weight))
        )
        super().__init__(model_path=model_path, **kwargs)

    @classmethod
    def default_model_path(cls) -> Path:
        return RESTORE_DIR / "codeformer" / "codeformer.onnx"

    def _restore_roi(self, roi_bgr: np.ndarray) -> np.ndarray | None:
        inputs = self._session.get_inputs()
        x_name = inputs[0].name
        feed = {x_name: self._normalize(roi_bgr)}
        if len(inputs) > 1:
            # Fidelity weight input (double scalar), e.g. "w".
            feed[inputs[1].name] = np.array(self.fidelity_weight, dtype=np.float64)
        outputs = self._session.run(None, feed)
        # The restored image is the 4D 3-channel output (y); skip logits etc.
        for out in outputs:
            if out.ndim == 4 and out.shape[1] == 3:
                return self._denormalize(out)
        return None


def create_enhancer(kind: str | None = None, pipeline: str = "offline") -> BaseEnhancer | None:
    """Factory used by the pipelines.

    `kind` comes from the FACE_ENHANCER env var (auto | gfpgan | codeformer |
    off). `pipeline` picks the recommended default when set to "auto":
    codeformer for offline broadcast, gfpgan for live streaming.
    """
    kind = (kind or os.environ.get("FACE_ENHANCER", "auto")).strip().lower()
    if kind in ("off", "none", "0", "false", ""):
        return None
    if kind == "auto":
        kind = "gfpgan" if pipeline == "live" else "codeformer"
    if kind in ("gfpgan", "gfpgan_roi"):
        return GFPGANEnhancer()
    if kind in ("codeformer", "codeformer_full"):
        return CodeFormerEnhancer()
    logger.warning("unknown FACE_ENHANCER=%r, face enhancement disabled", kind)
    return None
