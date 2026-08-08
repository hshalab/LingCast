import logging
import time

import requests

logger = logging.getLogger(__name__)


class TaskCallback:
    """Reports task status back to the Go API via its webhook endpoint."""

    def __init__(self, api_base_url: str, timeout: float = 10.0, retries: int = 3):
        self.api_base_url = api_base_url.rstrip("/")
        self.timeout = timeout
        self.retries = retries

    def update(
        self,
        task_id: int,
        status: str,
        output_url: str | None = None,
        error: str = "",
        progress: int | None = None,
        stage: str = "",
        tts_s3_key: str = "",
    ) -> None:
        url = f"{self.api_base_url}/api/tasks/{task_id}/status"
        payload = {"status": status}
        if output_url:
            payload["outputVideoS3Url"] = output_url
        if error:
            payload["error"] = error
        if progress is not None:
            payload["progress"] = progress
        if stage:
            payload["stage"] = stage
        if tts_s3_key:
            payload["ttsS3Key"] = tts_s3_key

        last_exc: Exception | None = None
        for attempt in range(self.retries):
            try:
                resp = requests.post(url, json=payload, timeout=self.timeout)
                resp.raise_for_status()
                logger.info("callback %s -> %s (%s)", url, resp.status_code, status)
                return
            except requests.RequestException as exc:
                last_exc = exc
                logger.warning(
                    "callback attempt %s/%s failed: %s",
                    attempt + 1,
                    self.retries,
                    exc,
                )
                if attempt + 1 < self.retries:
                    time.sleep(2**attempt)
        raise RuntimeError(f"failed to notify API after {self.retries} attempts: {last_exc}")

    def update_avatar_default_video(
        self, avatar_id: int, video_s3_key: str, status: str = "ready"
    ) -> None:
        """Persist the pre-processed default video into the avatar's default
        scene (default video)."""
        url = f"{self.api_base_url}/api/avatars/{avatar_id}/default-video"
        payload = {"videoS3Key": video_s3_key, "status": status}
        last_exc: Exception | None = None
        for attempt in range(self.retries):
            try:
                resp = requests.post(url, json=payload, timeout=self.timeout)
                resp.raise_for_status()
                logger.info("avatar default-video callback %s -> %s", url, resp.status_code)
                return
            except requests.RequestException as exc:
                last_exc = exc
                logger.warning(
                    "avatar base-video callback attempt %s/%s failed: %s",
                    attempt + 1,
                    self.retries,
                    exc,
                )
                if attempt + 1 < self.retries:
                    time.sleep(2**attempt)
        raise RuntimeError(
            f"failed to notify avatar default-video after {self.retries} attempts: {last_exc}"
        )

    def complete_scene_video(
        self,
        scene_video_id: int,
        status: str,
        s3_key: str = "",
        error: str = "",
    ) -> None:
        """Report the scene-video generation result (ready/failed)."""
        url = f"{self.api_base_url}/api/scene-videos/{scene_video_id}/complete"
        payload = {"status": status}
        if s3_key:
            payload["s3Key"] = s3_key
        if error:
            payload["errorMessage"] = error

        last_exc: Exception | None = None
        for attempt in range(self.retries):
            try:
                resp = requests.post(url, json=payload, timeout=self.timeout)
                resp.raise_for_status()
                logger.info(
                    "scene-video callback %s -> %s (%s)", url, resp.status_code, status
                )
                return
            except requests.RequestException as exc:
                last_exc = exc
                logger.warning(
                    "scene-video callback attempt %s/%s failed: %s",
                    attempt + 1,
                    self.retries,
                    exc,
                )
                if attempt + 1 < self.retries:
                    time.sleep(2**attempt)
        raise RuntimeError(
            f"failed to notify scene-video completion after {self.retries} attempts: {last_exc}"
        )

    def update_scene_video_progress(
        self,
        scene_video_id: int,
        stage: str,
        progress: int,
        detail: str = "",
    ) -> None:
        """Report fine-grained generation progress (stage timeline).
        Best-effort and non-fatal: a failed report must not slow rendering."""
        url = f"{self.api_base_url}/api/scene-videos/{scene_video_id}/progress"
        try:
            resp = requests.post(
                url,
                json={
                    "stage": stage,
                    "progress": max(0, min(100, progress)),
                    "detail": detail,
                },
                timeout=self.timeout,
            )
            resp.raise_for_status()
        except requests.RequestException as exc:
            logger.debug("scene-video progress report failed (non-fatal): %s", exc)
