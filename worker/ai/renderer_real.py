"""Real face animation via the official LivePortrait pipeline.

LivePortrait animates a source portrait using a driving video or a precomputed
motion template (.pkl). The synthesized TTS audio is then muxed onto the
animation. The official wrapper already selects MPS on Apple Silicon when
available; we pass the downloaded checkpoints explicitly so weights can live
under worker/models instead of inside the cloned repo.

Note on lip sync: LivePortrait transfers expression/pose from the driving
input. For phoneme-accurate audio-driven lip sync, a dedicated lip-sync model
(e.g. Wav2Lip) can be added as a post-stage; the renderer interface makes that
a drop-in change.
"""

import logging
import os
import subprocess
import sys
from pathlib import Path

from hardware import device_from_env

logger = logging.getLogger(__name__)

WORKER_ROOT = Path(__file__).resolve().parent.parent


class LivePortraitRenderer:
    def __init__(
        self,
        repo_dir: Path | None = None,
        models_dir: Path | None = None,
        driving: Path | None = None,
        device: str | None = None,
        output_fps: int | None = None,
        half: bool | None = None,
    ):
        self.repo_dir = repo_dir or Path(
            os.environ.get("LIVEPORTRAIT_REPO", WORKER_ROOT / "external" / "LivePortrait")
        )
        self.models_dir = models_dir or Path(
            os.environ.get(
                "LIVEPORTRAIT_MODELS_DIR", WORKER_ROOT / "models" / "liveportrait"
            )
        )
        self.driving = driving or Path(
            os.environ.get(
                "LIVEPORTRAIT_DRIVING",
                self.repo_dir / "assets" / "examples" / "driving" / "d1.pkl",
            )
        )
        self.device = device or device_from_env("LIVEPORTRAIT") or "cpu"
        self.output_fps = output_fps or int(os.environ.get("LIVEPORTRAIT_OUTPUT_FPS", "25"))
        self.half = (
            half
            if half is not None
            else os.environ.get("LIVEPORTRAIT_HALF", "").lower() == "true"
        )

        self._weights_base = self.models_dir / "liveportrait"
        self._check_environment()

    # ------------------------------------------------------------------ #
    # Renderer interface
    # ------------------------------------------------------------------ #
    def render(self, image_path: Path, tts_wav: Path, work_dir: Path) -> Path:
        if not image_path.exists():
            raise FileNotFoundError(f"avatar image not found: {image_path}")
        if not tts_wav.exists():
            raise FileNotFoundError(f"TTS audio not found: {tts_wav}")
        self._check_models()
        if not self.driving.exists():
            raise FileNotFoundError(
                f"driving input not found: {self.driving}\n"
                "Set LIVEPORTRAIT_DRIVING to a driving video or a .pkl motion "
                "template from the LivePortrait repo (assets/examples/driving)."
            )

        sys.path.insert(0, str(self.repo_dir))
        try:
            from src.config.argument_config import ArgumentConfig
            from src.config.crop_config import CropConfig
            from src.config.inference_config import InferenceConfig
            from src.live_portrait_pipeline import LivePortraitPipeline
        except ImportError as exc:
            raise RuntimeError(
                "LivePortrait code is missing or its dependencies are not installed. "
                "Run: python worker/download_models.py --models all, then install "
                "requirements (see README Phase 2)."
            ) from exc

        def partial_fields(target, kwargs):
            return target(**{k: v for k, v in kwargs.items() if hasattr(target, k)})

        out_dir = work_dir / "liveportrait_out"
        out_dir.mkdir(parents=True, exist_ok=True)

        args = ArgumentConfig(
            source=str(image_path.resolve()),
            driving=str(self.driving.resolve()),
            output_dir=str(out_dir),
            device_id=0,
            flag_force_cpu=(self.device == "cpu"),
            flag_use_half_precision=self.half,
        )

        inference_cfg = partial_fields(InferenceConfig, args.__dict__)
        crop_cfg = partial_fields(CropConfig, args.__dict__)

        inference_cfg.checkpoint_F = str(self._weights_base / "base_models" / "appearance_feature_extractor.pth")
        inference_cfg.checkpoint_M = str(self._weights_base / "base_models" / "motion_extractor.pth")
        inference_cfg.checkpoint_G = str(self._weights_base / "base_models" / "spade_generator.pth")
        inference_cfg.checkpoint_W = str(self._weights_base / "base_models" / "warping_module.pth")
        inference_cfg.checkpoint_S = str(
            self._weights_base / "retargeting_models" / "stitching_retargeting_module.pth"
        )
        crop_cfg.insightface_root = str(self.models_dir / "insightface")
        crop_cfg.landmark_ckpt_path = str(self._weights_base / "landmark.onnx")

        logger.info(
            "LivePortrait inference: device=%s driving=%s",
            self.device,
            self.driving.name,
        )
        pipeline = LivePortraitPipeline(inference_cfg=inference_cfg, crop_cfg=crop_cfg)
        wfp, _ = pipeline.execute(args)
        if not wfp or not Path(wfp).exists():
            raise RuntimeError(f"LivePortrait did not produce an output video ({wfp})")

        return self._mux_audio(Path(wfp), tts_wav, work_dir)

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    def _mux_audio(self, video: Path, tts_wav: Path, work_dir: Path) -> Path:
        final = work_dir / "final_avatar.mp4"
        duration = self._audio_duration(tts_wav)
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            # Loop the animation until the synthesized speech ends, so a short
            # driving template never truncates the audio.
            "-stream_loop", "-1",
            "-i", str(video),
            "-i", str(tts_wav),
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "128k",
            "-t", f"{duration:.3f}",
            str(final),
        ]
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        logger.info("LivePortrait renderer wrote %s", final)
        return final

    @staticmethod
    def _audio_duration(wav: Path) -> float:
        probe = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "csv=p=0",
                str(wav),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return float(probe.stdout.strip())

    def _check_environment(self) -> None:
        if self.device == "mps":
            try:
                import torch
            except ImportError as exc:
                raise RuntimeError(
                    "LIVEPORTRAIT_DEVICE=mps but PyTorch is not installed. "
                    "Install requirements.txt (or the CUDA build on Linux)."
                ) from exc
            if not (getattr(torch.backends, "mps", None) and torch.backends.mps.is_available()):
                raise RuntimeError(
                    "LIVEPORTRAIT_DEVICE=mps but this machine has no usable MPS. "
                    "Set LIVEPORTRAIT_DEVICE=cpu or run on Apple Silicon."
                )

    def _check_models(self) -> None:
        required = [
            "base_models/appearance_feature_extractor.pth",
            "base_models/motion_extractor.pth",
            "base_models/spade_generator.pth",
            "base_models/warping_module.pth",
            "retargeting_models/stitching_retargeting_module.pth",
            "landmark.onnx",
        ]
        missing = [
            rel for rel in required if not (self._weights_base / rel).exists()
        ]
        if not (self.models_dir / "insightface" / "models" / "buffalo_l").exists():
            missing.append("insightface/models/buffalo_l/")
        if missing:
            raise RuntimeError(
                "LivePortrait model weights are missing:\n  "
                + "\n  ".join(missing)
                + "\n\nDownload them with:\n"
                "  python worker/download_models.py --models liveportrait"
            )
