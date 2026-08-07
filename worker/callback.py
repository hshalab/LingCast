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

    def update_avatar_base_video(
        self, avatar_id: int, base_video_s3_key: str, status: str = "ready"
    ) -> None:
        """Persist the pre-processed base video S3 key on the avatar record."""
        url = f"{self.api_base_url}/api/avatars/{avatar_id}/base-video"
        payload = {"baseVideoS3Key": base_video_s3_key, "status": status}
        last_exc: Exception | None = None
        for attempt in range(self.retries):
            try:
                resp = requests.post(url, json=payload, timeout=self.timeout)
                resp.raise_for_status()
                logger.info("avatar base-video callback %s -> %s", url, resp.status_code)
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
            f"failed to notify avatar base-video after {self.retries} attempts: {last_exc}"
        )
