"""Real voice-clone TTS via the official GPT-SoVITS API server.

GPT-SoVITS does zero-shot voice cloning: a short reference audio plus the
script text produces speech matching the reference timbre. This class:
  1. writes a tts_infer.yaml pointing at the downloaded base models,
  2. starts GPT-SoVITS's api_v2.py (FastAPI) as a subprocess on first use,
  3. calls its /tts endpoint and saves the returned WAV to /tmp.

The S3/Redis orchestration is untouched; this class implements the same
interface as MockTTS.
"""

import logging
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import requests
import yaml

from hardware import device_from_env

logger = logging.getLogger(__name__)

WORKER_ROOT = Path(__file__).resolve().parent.parent


def detect_language(text: str) -> str:
    """Very small language guesser matching GPT-SoVITS's supported set."""
    if any("\u3040" <= ch <= "\u30ff" for ch in text):  # kana
        return "ja"
    if any("\uac00" <= ch <= "\ud7af" for ch in text):  # hangul
        return "ko"
    if any("\u4e00" <= ch <= "\u9fff" for ch in text):  # hanzi
        return "zh"
    return "en"


class GPTSoVITSTTS:
    """Zero-shot voice-clone TTS backed by GPT-SoVITS."""

    # (version -> required weight files relative to models dir)
    REQUIRED_FILES = {
        "v2": [
            "chinese-hubert-base/config.json",
            "chinese-roberta-wwm-ext-large/config.json",
            "gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt",
            "gsv-v2final-pretrained/s2G2333k.pth",
        ],
    }

    def __init__(
        self,
        api_url: str | None = None,
        repo_dir: Path | None = None,
        models_dir: Path | None = None,
        port: int | None = None,
        device: str | None = None,
        is_half: bool | None = None,
        version: str = "v2",
        prompt_text: str | None = None,
        prompt_lang: str | None = None,
        text_lang: str | None = None,
        server_timeout: int = 900,
    ):
        self.api_url = (api_url or os.environ.get("GPT_SOVITS_API_URL") or "").rstrip("/")
        self.repo_dir = repo_dir or Path(
            os.environ.get("GPT_SOVITS_REPO", WORKER_ROOT / "external" / "GPT-SoVITS")
        )
        self.models_dir = models_dir or Path(
            os.environ.get("GPT_SOVITS_MODELS_DIR", WORKER_ROOT / "models" / "gpt-sovits")
        )
        self.port = port or int(os.environ.get("GPT_SOVITS_PORT", "9880"))
        self.device = device or device_from_env("GPT_SOVITS") or "cpu"
        self.is_half = (
            is_half
            if is_half is not None
            else os.environ.get("GPT_SOVITS_IS_HALF", "").lower() == "true"
            or self.device == "cuda"
        )
        self.version = version
        self.prompt_text = (
            prompt_text
            if prompt_text is not None
            else os.environ.get("GPT_SOVITS_PROMPT_TEXT", "")
        )
        self.prompt_lang = prompt_lang or os.environ.get("GPT_SOVITS_PROMPT_LANG", "zh")
        self.text_lang = text_lang or os.environ.get("GPT_SOVITS_LANG") or ""
        self.server_timeout = server_timeout
        self._process: subprocess.Popen | None = None
        self._config_path: Path | None = None

    # ------------------------------------------------------------------ #
    # TTS interface
    # ------------------------------------------------------------------ #
    def synthesize(
        self,
        script_text: str,
        reference_audio: Path | None,
        out_wav: Path,
    ) -> Path:
        if reference_audio is None or not reference_audio.exists():
            raise RuntimeError(
                "GPT-SoVITS zero-shot voice cloning requires a reference audio. "
                "Upload a voice sample via Avatar Studio before creating a task."
            )

        self._ensure_server()
        out_wav.parent.mkdir(parents=True, exist_ok=True)

        text_lang = self.text_lang or detect_language(script_text)
        payload = {
            "text": script_text,
            "text_lang": text_lang,
            "ref_audio_path": str(reference_audio.resolve()),
            "prompt_text": self.prompt_text,
            "prompt_lang": self.prompt_lang,
            "text_split_method": "cut5",
            "batch_size": 1,
            "media_type": "wav",
            "streaming_mode": False,
            "speed_factor": 1.0,
            "seed": -1,
            "parallel_infer": True,
            "repetition_penalty": 1.35,
        }

        logger.info(
            "GPT-SoVITS /tts: lang=%s ref=%s out=%s",
            text_lang,
            reference_audio.name,
            out_wav.name,
        )
        try:
            resp = requests.post(
                f"{self.api_url}/tts", json=payload, timeout=self.server_timeout
            )
        except requests.RequestException as exc:
            raise RuntimeError(f"GPT-SoVITS /tts request failed: {exc}") from exc

        if resp.status_code != 200:
            raise RuntimeError(
                f"GPT-SoVITS /tts returned {resp.status_code}: {resp.text[:500]}"
            )
        if not resp.content:
            raise RuntimeError("GPT-SoVITS /tts returned an empty response")

        out_wav.write_bytes(resp.content)
        logger.info("GPT-SoVITS saved %s (%s bytes)", out_wav, out_wav.stat().st_size)
        return out_wav

    def close(self) -> None:
        if self._process is not None and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self._process.kill()
            logger.info("GPT-SoVITS API server stopped")
        self._process = None

    # ------------------------------------------------------------------ #
    # Server lifecycle
    # ------------------------------------------------------------------ #
    def _ensure_server(self) -> None:
        if self.api_url:
            return
        if self._process is not None and self._process.poll() is None:
            return

        self._check_models()
        config_path = self._write_config()
        log_path = self.models_dir / "gpt_sovits_server.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_file = open(log_path, "a", encoding="utf-8")  # noqa: SIM115 - subprocess fd

        cmd = [
            sys.executable,
            "api_v2.py",
            "-a", "127.0.0.1",
            "-p", str(self.port),
            "-c", str(config_path),
        ]
        env = dict(os.environ)
        env["PYTHONPATH"] = str(self.repo_dir)
        logger.info("starting GPT-SoVITS API server: %s", " ".join(cmd))
        self._process = subprocess.Popen(
            cmd,
            cwd=str(self.repo_dir),
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
        )

        self._wait_until_ready()
        self.api_url = f"http://127.0.0.1:{self.port}"

    def _wait_until_ready(self, interval: float = 3.0) -> None:
        deadline = time.monotonic() + self.server_timeout
        while time.monotonic() < deadline:
            if self._process is not None and self._process.poll() is not None:
                log = (self.models_dir / "gpt_sovits_server.log").read_text(
                    encoding="utf-8", errors="ignore"
                )
                raise RuntimeError(
                    "GPT-SoVITS API server exited during startup. "
                    f"See {self.models_dir / 'gpt_sovits_server.log'}. "
                    f"Tail:\n{log[-1000:]}"
                )
            try:
                with socket.create_connection(("127.0.0.1", self.port), timeout=1):
                    logger.info("GPT-SoVITS API server ready on port %s", self.port)
                    return
            except OSError:
                time.sleep(interval)
        raise TimeoutError(
            "GPT-SoVITS API server did not become ready within "
            f"{self.server_timeout}s (first model load can be slow). "
            f"See {self.models_dir / 'gpt_sovits_server.log'}"
        )

    # ------------------------------------------------------------------ #
    # Models & config
    # ------------------------------------------------------------------ #
    def _check_models(self) -> None:
        missing = [
            rel
            for rel in self.REQUIRED_FILES[self.version]
            if not (self.models_dir / rel).exists()
        ]
        if missing:
            raise RuntimeError(
                "GPT-SoVITS model weights are missing:\n  "
                + "\n  ".join(str(self.models_dir / m) for m in missing)
                + "\n\nDownload them with:\n"
                "  python worker/download_models.py --models gpt-sovits"
            )

    def _write_config(self) -> Path:
        repo_config = self.repo_dir / "GPT_SoVITS" / "configs" / "tts_infer.yaml"
        if not repo_config.exists():
            raise RuntimeError(
                f"GPT-SoVITS repo config not found at {repo_config}. "
                "Clone the repo with: python worker/download_models.py --models all"
            )

        with repo_config.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh)

        data["custom"] = {
            "bert_base_path": str(self.models_dir / "chinese-roberta-wwm-ext-large"),
            "cnhuhbert_base_path": str(self.models_dir / "chinese-hubert-base"),
            "device": self.device,
            "is_half": self.is_half,
            "t2s_weights_path": str(
                self.models_dir / "gsv-v2final-pretrained"
                / "s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt"
            ),
            "version": self.version,
            "vits_weights_path": str(
                self.models_dir / "gsv-v2final-pretrained" / "s2G2333k.pth"
            ),
        }

        config_path = self.models_dir / "tts_infer.yaml"
        with config_path.open("w", encoding="utf-8") as fh:
            yaml.safe_dump(data, fh, allow_unicode=True, sort_keys=False)
        return config_path
