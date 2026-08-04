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
    ) -> None:
        url = f"{self.api_base_url}/api/tasks/{task_id}/status"
        payload = {"status": status}
        if output_url:
            payload["outputVideoS3Url"] = output_url
        if error:
            payload["error"] = error

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
