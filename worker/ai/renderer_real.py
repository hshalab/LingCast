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

Motion feel is controlled by the driving template plus two knobs:
  - LIVEPORTRAIT_DRIVING: which .pkl template drives the animation (default
    d5.pkl, a ~5s natural talking-head clip; d1.pkl is only 0.5s and reads as
    frantic blinking/shrugging when looped).
  - LIVEPORTRAIT_DRIVING_SPEED: temporal playback speed (1.0 = original;
    0.5 = half speed / 2x slower). The template's motion features are
    interpolated in time, so blinks and shoulder motion become calmer.
  - LIVEPORTRAIT_DRIVING_MULTIPLIER: motion amplitude (1.0 = original;
    0.7 = subtler gestures), passed to LivePortrait's driving_multiplier.
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
                self.repo_dir / "assets" / "examples" / "driving" / "d5.pkl",
            )
        )
        self.device = device or device_from_env("LIVEPORTRAIT") or "cpu"
        self.output_fps = output_fps or int(os.environ.get("LIVEPORTRAIT_OUTPUT_FPS", "24"))
        self.driving_speed = float(
            os.environ.get("LIVEPORTRAIT_DRIVING_SPEED", "1.0")
        )
        self.driving_multiplier = float(
            os.environ.get("LIVEPORTRAIT_DRIVING_MULTIPLIER", "1.0")
        )
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
        """Animate the avatar image (blink/micro-motion template) and return a
        silent `base_video.mp4` with the same length as the TTS audio.

        Audio and lip motion are added later by Wav2LipLipSync.
        """
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
                "Run: cd worker && uv run python download_models.py --models all, then install "
                "requirements (see README Phase 2)."
            ) from exc

        def partial_fields(target, kwargs):
            return target(**{k: v for k, v in kwargs.items() if hasattr(target, k)})

        out_dir = work_dir / "liveportrait_out"
        out_dir.mkdir(parents=True, exist_ok=True)

        driving = self._resolve_driving(work_dir)

        args = ArgumentConfig(
            source=str(image_path.resolve()),
            driving=str(driving.resolve()),
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
        inference_cfg.driving_multiplier = self.driving_multiplier

        logger.info(
            "LivePortrait inference: device=%s driving=%s speed=%s multiplier=%s",
            self.device,
            driving.name,
            self.driving_speed,
            self.driving_multiplier,
        )
        pipeline = LivePortraitPipeline(inference_cfg=inference_cfg, crop_cfg=crop_cfg)
        wfp, _ = pipeline.execute(args)
        if not wfp or not Path(wfp).exists():
            raise RuntimeError(f"LivePortrait did not produce an output video ({wfp})")

        return self._loop_base_video(Path(wfp), tts_wav, work_dir)

    def _resolve_driving(self, work_dir: Path) -> Path:
        """Apply the temporal speed knob to a .pkl driving template."""
        driving = self.driving
        if self.driving_speed == 1.0:
            return driving
        if driving.suffix != ".pkl" or not driving.exists():
            logger.warning(
                "LIVEPORTRAIT_DRIVING_SPEED only applies to .pkl templates; "
                "ignored for %s",
                driving,
            )
            return driving
        return self._slow_template(driving, self.driving_speed, work_dir)

    @staticmethod
    def _slow_template(driving: Path, speed: float, work_dir: Path) -> Path:
        """Stretch a motion template in time by interpolating its features.

        LivePortrait replays the template at a fixed fps, so a short template
        (e.g. d1.pkl: 16 frames = 0.5s) loops constantly and reads as frantic.
        We resample every motion feature (exp/t/scale/R/c_eyes/c_lip) to
        `n_frames / speed` frames; the same gestures then take longer, e.g.
        speed=0.5 makes everything 2x slower.
        """
        import numpy as np

        from src.utils.io import dump, load

        dct = load(str(driving))
        n = int(dct["n_frames"])
        new_n = max(2, int(round(n / speed)))
        if new_n == n:
            return driving

        # Position of each new frame in the original frame space.
        pos = np.arange(new_n, dtype=np.float32) * speed
        i0 = np.floor(pos).astype(int)
        i1 = np.minimum(i0 + 1, n - 1)
        frac = (pos - i0).astype(np.float32)

        from scipy.spatial.transform import Rotation

        def _slerp(a_mat: np.ndarray, b_mat: np.ndarray, f: float) -> np.ndarray:
            """Spherical interpolation between two 3x3 rotation matrices."""
            qa = Rotation.from_matrix(a_mat).as_quat()
            qb = Rotation.from_matrix(b_mat).as_quat()
            dot = float(np.dot(qa, qb))
            if dot < 0.0:
                qb, dot = -qb, -dot
            if dot > 0.9995:  # nearly identical rotations: plain lerp is fine
                q = qa + f * (qb - qa)
            else:
                theta = np.arccos(np.clip(dot, -1.0, 1.0))
                q = (np.sin((1.0 - f) * theta) * qa + np.sin(f * theta) * qb) / np.sin(
                    theta
                )
            q /= np.linalg.norm(q)
            return Rotation.from_quat(q).as_matrix()

        motion = dct["motion"]
        new_motion = []
        for j in range(new_n):
            a, b, f = motion[i0[j]], motion[i1[j]], frac[j]
            item = {}
            for key in a:
                va, vb = a[key], b[key]
                if key in ("R", "R_d") and va.shape == (1, 3, 3):
                    item[key] = _slerp(va.reshape(3, 3), vb.reshape(3, 3), f).reshape(
                        va.shape
                    ).astype(np.float32)
                else:
                    item[key] = ((1.0 - f) * va + f * vb).astype(np.float32)
            new_motion.append(item)

        slowed = dict(dct)
        slowed["n_frames"] = new_n
        slowed["motion"] = new_motion
        for key in ("c_d_eyes_lst", "c_eyes_lst"):
            if key in slowed:
                seq = slowed[key]
                slowed[key] = [
                    ((1.0 - frac[j]) * seq[i0[j]] + frac[j] * seq[i1[j]]).astype(
                        np.float32
                    )
                    for j in range(new_n)
                ]
        for key in ("c_d_lip_lst", "c_lip_lst"):
            if key in slowed:
                seq = slowed[key]
                slowed[key] = [
                    ((1.0 - frac[j]) * seq[i0[j]] + frac[j] * seq[i1[j]]).astype(
                        np.float32
                    )
                    for j in range(new_n)
                ]

        out = work_dir / f"driving_slow_{speed:.2f}.pkl"
        dump(str(out), slowed)
        logger.info(
            "slowed driving template %s: %d -> %d frames (speed=%s)",
            driving.name,
            n,
            new_n,
            speed,
        )
        return out

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    def _loop_base_video(self, video: Path, tts_wav: Path, work_dir: Path) -> Path:
        """Loop the animation to the TTS length; the output has no audio."""
        final = work_dir / "base_video.mp4"
        duration = self._audio_duration(tts_wav)
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            # Loop the animation until the synthesized speech ends, so a short
            # driving template covers the whole speech.
            "-stream_loop", "-1",
            "-i", str(video),
            "-t", f"{duration + 0.2:.3f}",
            "-r", str(self.output_fps),
            "-an",
            "-c:v", "libx264", "-preset", "veryfast",
            "-pix_fmt", "yuv420p",
            str(final),
        ]
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        logger.info("LivePortrait renderer wrote base video %s", final)
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
                    "Run `uv sync --all-groups` (or install the CUDA PyTorch build on Linux)."
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
                "  cd worker && uv run python download_models.py --models liveportrait"
            )
