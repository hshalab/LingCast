"""Scene-video generation providers (extensible registry).

The Go backend creates a `scene_videos` row (status=generating) and dispatches
the job through the video-gen microservice; the host worker pops the job and
runs the provider here. Each provider turns an S3 source image into a video
file, which the caller uploads back to S3 and completes via the Go webhook.
"""

import logging
from pathlib import Path

from ai.renderer_real import LivePortraitRenderer

logger = logging.getLogger(__name__)

# Provider registry (kept in sync with services/video-gen/main.py).
PROVIDERS = {
    "liveportrait": "implemented",
    "comfyui": "planned",
}


def generate_video(
    provider: str,
    source_image: Path,
    settings: dict | None,
    work_dir: Path,
    progress_cb=None,
) -> Path:
    """Run one video-generation provider and return the output video path."""
    if provider == "liveportrait":
        renderer = LivePortraitRenderer(settings=settings, progress_cb=progress_cb)
        return renderer.render_base(source_image, work_dir)
    raise NotImplementedError(
        f"video generation provider {provider!r} is not implemented yet "
        f"(registered providers: {sorted(PROVIDERS)})"
    )
