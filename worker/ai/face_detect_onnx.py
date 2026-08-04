"""Lightweight face detection for the lip-sync stage.

Wraps the SCRFD-2.5G ONNX model used by zhangziliang04/wav2lip-onnx
(originally from SimSwap/insightface). Decoding mirrors insightface's
`model_zoo/scrfd.py` exactly, but with zero insightface/torch dependencies:
the whole face-detection step runs through onnxruntime (CoreML on macOS).
"""

import logging
from pathlib import Path

import cv2
import numpy as np

from .onnx_utils import build_session

logger = logging.getLogger(__name__)

_STRIDES = (8, 16, 32)
_NUM_ANCHORS = 2  # this exported SCRFD variant has 2 anchors per grid cell


def _distance2bbox(points: np.ndarray, distance: np.ndarray) -> np.ndarray:
    x1 = points[:, 0] - distance[:, 0]
    y1 = points[:, 1] - distance[:, 1]
    x2 = points[:, 0] + distance[:, 2]
    y2 = points[:, 1] + distance[:, 3]
    return np.stack([x1, y1, x2, y2], axis=-1)


def _distance2kps(points: np.ndarray, distance: np.ndarray) -> np.ndarray:
    preds = []
    for i in range(0, distance.shape[1], 2):
        preds.append(points[:, 0] + distance[:, i])
        preds.append(points[:, 1] + distance[:, i + 1])
    return np.stack(preds, axis=-1)


def _nms(dets: np.ndarray, thresh: float = 0.4) -> list[int]:
    x1, y1, x2, y2, scores = dets[:, 0], dets[:, 1], dets[:, 2], dets[:, 3], dets[:, 4]
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size > 0:
        i = order[0]
        keep.append(int(i))
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w = np.maximum(0.0, xx2 - xx1 + 1)
        h = np.maximum(0.0, yy2 - yy1 + 1)
        inter = w * h
        ovr = inter / (areas[i] + areas[order[1:]] - inter)
        order = order[np.where(ovr <= thresh)[0] + 1]
    return keep


class ScrfdFaceDetector:
    """SCRFD-2.5G face detector running purely on onnxruntime."""

    def __init__(
        self,
        model_path: Path,
        det_size: tuple[int, int] = (320, 320),
        det_thresh: float = 0.6,
    ):
        self.model_path = Path(model_path)
        self.det_size = det_size
        self.det_thresh = det_thresh
        self.session = build_session(self.model_path)
        self._anchor_cache: dict[tuple[int, int, int], np.ndarray] = {}
        self._bigger: ScrfdFaceDetector | None = None

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #
    def detect_batch(self, frames: list[np.ndarray]) -> list[tuple[int, int, int, int] | None]:
        """Return one bounding box (x1, y1, x2, y2) per frame, or None."""
        boxes: list[tuple[int, int, int, int] | None] = []
        for frame in frames:
            box = self._detect_one(frame)
            boxes.append(box)
        return boxes

    def detect(self, frame: np.ndarray) -> tuple[int, int, int, int] | None:
        """Detect the best face in a single BGR frame."""
        return self._detect_one(frame)

    # ------------------------------------------------------------------ #
    # Internals (mirrors insightface SCRFD forward/detect)
    # ------------------------------------------------------------------ #
    def _decode(self, img: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        det_size = self.det_size
        im_ratio = img.shape[0] / img.shape[1]
        model_ratio = det_size[1] / det_size[0]
        if im_ratio > model_ratio:
            new_h, new_w = det_size[1], int(det_size[1] / im_ratio)
        else:
            new_w, new_h = det_size[0], int(det_size[0] * im_ratio)
        det_scale = new_h / img.shape[0]
        resized = cv2.resize(img, (new_w, new_h))
        det_img = np.zeros((det_size[1], det_size[0], 3), dtype=np.uint8)
        det_img[:new_h, :new_w, :] = resized
        blob = cv2.dnn.blobFromImage(
            det_img, 1.0 / 128.0, (det_size[0], det_size[1]), (127.5, 127.5, 127.5), swapRB=True
        )
        outs = self.session.run(None, {self.session.get_inputs()[0].name: blob})

        in_h, in_w = det_size[1], det_size[0]
        scores_list, bboxes_list, kpss_list = [], [], []
        for idx, stride in enumerate(_STRIDES):
            scores = outs[idx].ravel()
            bbox_preds = outs[idx + 3] * stride
            kps_preds = outs[idx + 6] * stride
            h, w = in_h // stride, in_w // stride
            key = (h, w, stride)
            centers = self._anchor_cache.get(key)
            if centers is None:
                centers = np.stack(np.mgrid[:h, :w][::-1], axis=-1).astype(np.float32)
                centers = (centers * stride).reshape(-1, 2)
                centers = np.stack([centers] * _NUM_ANCHORS, axis=1).reshape(-1, 2)
                self._anchor_cache[key] = centers

            bboxes = _distance2bbox(centers, bbox_preds)
            kpss = _distance2kps(centers, kps_preds).reshape(-1, 5, 2)
            pos = np.where(scores >= self.det_thresh)[0]
            scores_list.append(scores[pos])
            bboxes_list.append(bboxes[pos])
            kpss_list.append(kpss[pos])

        if not scores_list or sum(s.size for s in scores_list) == 0:
            return np.empty((0, 5), dtype=np.float32), np.empty((0, 5, 2), dtype=np.float32)

        scores = np.hstack(scores_list)
        bboxes = np.vstack(bboxes_list) / det_scale
        kpss = np.vstack(kpss_list) / det_scale
        pre_det = np.hstack([bboxes, scores.reshape(-1, 1)])
        order = pre_det[:, 4].argsort()[::-1]
        pre_det = pre_det[order]
        kpss = kpss[order]
        keep = _nms(pre_det)
        return pre_det[keep], kpss[keep]

    def _detect_one(self, frame: np.ndarray) -> tuple[int, int, int, int] | None:
        dets, _ = self._decode(frame)
        if dets.shape[0] == 0:
            # Low-res miss (e.g. small face)? Retry at full size before giving up.
            if self.det_size != (640, 640):
                if self._bigger is None:
                    self._bigger = ScrfdFaceDetector(
                        self.model_path, det_size=(640, 640), det_thresh=self.det_thresh
                    )
                dets, _ = self._bigger._decode(frame)
                self._anchor_cache.update(self._bigger._anchor_cache)
        if dets.shape[0] == 0:
            return None
        x1, y1, x2, y2 = (int(round(v)) for v in dets[0, :4])
        return x1, y1, x2, y2
