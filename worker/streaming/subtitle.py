"""Burn spoken text as a subtitle overlay on BGR frames using Pillow.

The brew ffmpeg build has no drawtext filter (that needs ffmpeg-full), so we
render subtitles in Python before frames enter the pipe. The CJK font path is
configurable via STREAM_SUBTITLE_FONT (defaults to a macOS system font).
"""

import logging
import os

import cv2
import numpy as np

logger = logging.getLogger(__name__)


class SubtitleRenderer:
    def __init__(self, font_path: str | None = None, font_size: int = 46):
        self.font_path = font_path or os.environ.get(
            "STREAM_SUBTITLE_FONT", "/System/Library/Fonts/STHeiti Medium.ttc"
        )
        self.font_size = font_size
        self._font = None

    def _ensure_font(self):
        if self._font is None:
            from PIL import ImageFont

            try:
                self._font = ImageFont.truetype(self.font_path, self.font_size)
            except Exception:
                logger.warning(
                    "CJK font %s unavailable, falling back to default", self.font_path
                )
                self._font = ImageFont.load_default()
        return self._font

    def draw(self, frame: np.ndarray, text: str) -> np.ndarray:
        """Return a copy of the BGR frame with `text` drawn near the bottom."""
        if not text:
            return frame
        from PIL import Image, ImageDraw

        font = self._ensure_font()
        h, w = frame.shape[:2]
        pil = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(pil)

        # Wrap into lines that fit the canvas width.
        max_chars = max(4, (w - 40) // (self.font_size + 2))
        lines = [
            text[i : i + max_chars]
            for i in range(0, len(text), max_chars)
        ][:3]  # at most 3 lines
        pad = 12
        line_h = self.font_size + 10
        total_h = len(lines) * line_h
        y0 = h - total_h - 70

        for li, line in enumerate(lines):
            bbox = draw.textbbox((0, 0), line, font=font)
            tw = bbox[2] - bbox[0]
            x = (w - tw) // 2
            y = y0 + li * line_h
            draw.rectangle([x - pad, y - pad, x + tw + pad, y + self.font_size + pad], fill=(0, 0, 0, 150))
            draw.text(
                (x, y),
                line,
                font=font,
                fill=(255, 255, 255),
                stroke_width=2,
                stroke_fill=(0, 0, 0),
            )

        return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
