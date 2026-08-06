#!/usr/bin/env python3
"""Download the code and weights needed by the hybrid real-model worker.

Fetches:
  - GPT-SoVITS  (code: RVC-Boss/GPT-SoVITS, weights: lj1995/GPT-SoVITS)
  - LivePortrait (code: KwaiVGI/LivePortrait, weights: KwaiVGI/LivePortrait HF)
  - Wav2Lip ONNX (weights: camenduru/Wav2Lip .pth, then exported to .onnx
    locally; face detector: scrfd_2.5g from zhangziliang04/wav2lip-onnx)
  - Face restoration (fixes Wav2Lip lip deformation):
    GFPGANv1.4.onnx + CodeFormer codeformer.onnx -> worker/models/restoration/

Layout (both are gitignored):
  worker/external/            cloned inference code
  worker/models/
    gpt-sovits/
      chinese-hubert-base/
      chinese-roberta-wwm-ext-large/
      gsv-v2final-pretrained/
    liveportrait/
      liveportrait/base_models|retargeting_models|landmark.onnx
      insightface/models/buffalo_l/

Usage (run from the worker directory so `uv` picks up worker/.python-version):
  cd worker
  uv run python download_models.py --models all                 # code + weights
  uv run python download_models.py --models liveportrait        # only LivePortrait
  uv run python download_models.py --dry-run                    # show what would download
  HF_ENDPOINT=https://hf-mirror.com uv run python download_models.py   # CN mirror
"""

import argparse
import fnmatch
import os
import subprocess
import sys
from pathlib import Path

WORKER_ROOT = Path(__file__).resolve().parent
EXTERNAL_DIR = WORKER_ROOT / "external"
MODELS_DIR = WORKER_ROOT / "models"

REPO_CODE = {
    "gpt-sovits": (
        "https://github.com/RVC-Boss/GPT-SoVITS.git",
        EXTERNAL_DIR / "GPT-SoVITS",
    ),
    "liveportrait": (
        "https://github.com/KwaiVGI/LivePortrait.git",
        EXTERNAL_DIR / "LivePortrait",
    ),
    "wav2lip": (
        "https://github.com/Rudrabha/Wav2Lip.git",
        EXTERNAL_DIR / "Wav2Lip",
    ),
}

HF_WEIGHTS = {
    "gpt-sovits": {
        "repo_id": "lj1995/GPT-SoVITS",
        "patterns": [
            "chinese-hubert-base/*",
            "chinese-roberta-wwm-ext-large/*",
            "gsv-v2final-pretrained/*",
        ],
        "dest": MODELS_DIR / "gpt-sovits",
    },
    "liveportrait": {
        "repo_id": "KwaiVGI/LivePortrait",
        "patterns": [
            "liveportrait/base_models/*",
            "liveportrait/retargeting_models/*",
            "liveportrait/landmark.onnx",
            "insightface/models/buffalo_l/*",
        ],
        "dest": MODELS_DIR / "liveportrait",
    },
    "wav2lip": {
        "repo_id": "camenduru/Wav2Lip",
        "patterns": [
            "checkpoints/wav2lip_gan.pth",
            "checkpoints/s3fd-619a316812.pth",
        ],
        "dest": MODELS_DIR / "wav2lip",
    },
}


def clone_repo(name: str, shallow: bool = True) -> None:
    url, dest = REPO_CODE[name]
    if dest.exists():
        print(f"[skip] {name} code already present at {dest}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["git", "clone"]
    if shallow:
        cmd += ["--depth", "1"]
    cmd += [url, str(dest)]
    print(f"[{name}] cloning {url} -> {dest}")
    subprocess.run(cmd, check=True)


def _matched_files(spec: dict) -> list[str]:
    from huggingface_hub import list_repo_files

    files = list_repo_files(spec["repo_id"])
    return [
        f
        for f in files
        if any(fnmatch.fnmatch(f, p) for p in spec["patterns"])
    ]


def download_weights(name: str, dry_run: bool = False) -> None:
    spec = HF_WEIGHTS[name]
    dest = spec["dest"]

    if dry_run:
        matched = _matched_files(spec)
        print(f"[{name}] dry-run: {len(matched)} files would be downloaded from {spec['repo_id']}:")
        for f in sorted(matched):
            print(f"    {f}")
        return

    from huggingface_hub import snapshot_download

    print(f"[{name}] downloading weights from {spec['repo_id']} -> {dest}")
    snapshot_download(
        repo_id=spec["repo_id"],
        allow_patterns=spec["patterns"],
        local_dir=dest,
    )
    print(f"[{name}] weights ready at {dest}")


def write_models_readme() -> None:
    readme = MODELS_DIR / "README.md"
    readme.parent.mkdir(parents=True, exist_ok=True)
    readme.write_text(
        """# worker/models (gitignored)

Pretrained weights for the hybrid real-model worker. Regenerate with:

    cd worker && uv run python download_models.py --models all

Layout:

    gpt-sovits/
      chinese-hubert-base/            # HuBERT features (GPT-SoVITS)
      chinese-roberta-wwm-ext-large/  # BERT text encoder (GPT-SoVITS)
      gsv-v2final-pretrained/         # s1/s2 v2 base models
    liveportrait/
      liveportrait/base_models/       # F, M, G, W checkpoints
      liveportrait/retargeting_models/  # stitching/retargeting module
      liveportrait/landmark.onnx
      insightface/models/buffalo_l/   # face detection
    wav2lip/
      checkpoints/wav2lip_gan.pth     # lip-sync generator
      checkpoints/s3fd-619a316812.pth # face detector
      checkpoints/wav2lip_gan.onnx    # exported from the .pth (fast ONNX path)
      scrfd/scrfd_2.5g_bnkps.onnx     # ONNX face detector (no torch needed)
    restoration/
      gfpgan/GFPGANv1.4.onnx          # GFPGANv1.4 (live ROI face restoration)
      codeformer/codeformer.onnx      # CodeFormer (offline full-face restoration)

Optional (Chinese TTS polyphone quality): download G2PWModel.zip from the
GPT-SoVITS docs and unpack it to
worker/external/GPT-SoVITS/GPT_SoVITS/text/G2PWModel.
""",
        encoding="utf-8",
    )


def setup_gpt_sovits_links() -> None:
    """Point GPT-SoVITS's default relative paths at our downloaded weights.

    Several GPT-SoVITS components (e.g. the G2PW Chinese frontend) reference
    GPT_SoVITS/pretrained_models/... relatively. Symlinks make those resolve
    to worker/models without duplicating gigabytes of weights.
    """
    weights = MODELS_DIR / "gpt-sovits"
    if not weights.exists():
        return
    repo = EXTERNAL_DIR / "GPT-SoVITS"
    pretrained = repo / "GPT_SoVITS" / "pretrained_models"
    pretrained.mkdir(parents=True, exist_ok=True)
    for name in (
        "chinese-hubert-base",
        "chinese-roberta-wwm-ext-large",
        "gsv-v2final-pretrained",
    ):
        target = pretrained / name
        if target.is_symlink() or target.exists():
            continue
        try:
            target.symlink_to(weights / name, target_is_directory=True)
            print(f"[gpt-sovits] linked {target} -> {weights / name}")
        except FileExistsError:
            pass


def patch_g2pw_model_source() -> None:
    """Make the auto-downloaded G2PW frontend reuse our local BERT weights."""
    config = EXTERNAL_DIR / "GPT-SoVITS" / "GPT_SoVITS" / "text" / "G2PWModel" / "config.py"
    if not config.exists():
        print(
            "[gpt-sovits] G2PWModel not present yet; it is auto-downloaded from "
            "ModelScope on the first real TTS run (or download it manually)."
        )
        return
    source = config.read_text(encoding="utf-8")
    if "worker/models/gpt-sovits" in source:
        return
    local_bert = MODELS_DIR / "gpt-sovits" / "chinese-roberta-wwm-ext-large"
    if not local_bert.exists():
        return
    lines = [
        "model_source = "
        + repr(str(local_bert))
        if line.startswith("model_source")
        else line
        for line in source.splitlines()
    ]
    config.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[gpt-sovits] patched G2PW model_source -> {local_bert}")


def setup_wav2lip_links() -> None:
    """Point Wav2Lip's vendored face detector at our downloaded s3fd weights."""
    weights = MODELS_DIR / "wav2lip" / "checkpoints" / "s3fd-619a316812.pth"
    if not weights.exists():
        return
    target = EXTERNAL_DIR / "Wav2Lip" / "face_detection" / "detection" / "sfd" / "s3fd.pth"
    if target.is_symlink() or target.exists():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    target.symlink_to(weights.resolve())
    print(f"[wav2lip] linked {target} -> {weights}")


def export_wav2lip_onnx() -> None:
    """Export the downloaded wav2lip_gan.pth to ONNX for fast CPU/CoreML runs.

    The PyTorch Wav2Lip stage is pathologically slow on Apple Silicon (MPS
    LSTM) and pegs every CPU core. The same weights exported to ONNX run at
    real-time speed through onnxruntime (CoreML EP preferred). This reuses the
    .pth already on disk, so no extra weight download is needed.
    """
    import sys
    import torch

    pth = MODELS_DIR / "wav2lip" / "checkpoints" / "wav2lip_gan.pth"
    out = MODELS_DIR / "wav2lip" / "checkpoints" / "wav2lip_gan.onnx"
    if out.exists():
        print(f"[wav2lip] onnx already present at {out}")
        return
    if not pth.exists():
        raise RuntimeError(
            f"{pth} not found - download it first with:\n"
            "  uv run python download_models.py --models wav2lip"
        )

    repo = EXTERNAL_DIR / "Wav2Lip"
    if not (repo / "models" / "wav2lip.py").exists():
        raise RuntimeError(
            "Wav2Lip inference code is missing - run without --no-code:\n"
            "  uv run python download_models.py --models wav2lip"
        )
    sys.path.insert(0, str(repo))
    from models.wav2lip import Wav2Lip

    print(f"[wav2lip] exporting {pth.name} -> {out.name} (takes ~1 min)")
    model = Wav2Lip()
    state = torch.load(str(pth), map_location="cpu", weights_only=False)["state_dict"]
    model.load_state_dict({k.replace("module.", ""): v for k, v in state.items()})
    model.eval()
    torch.onnx.export(
        model,
        (torch.randn(1, 1, 80, 16), torch.randn(1, 6, 96, 96)),
        str(out),
        export_params=True,
        opset_version=10,
        input_names=["mel_spectrogram", "video_frames"],
        output_names=["predicted_frames"],
        dynamic_axes={
            "mel_spectrogram": {0: "batch_size"},
            "video_frames": {0: "batch_size"},
        },
        # Torch 2.9+ defaults to the new dynamo exporter, which needs
        # onnxscript; the legacy exporter needs no extra dependency.
        dynamo=False,
    )
    print(f"[wav2lip] onnx ready at {out} ({out.stat().st_size / 1e6:.0f} MB)")


def download_scrfd() -> None:
    """Fetch the SCRFD-2.5G ONNX face detector used by the ONNX lip-sync stage."""
    import requests

    dest = MODELS_DIR / "wav2lip" / "scrfd" / "scrfd_2.5g_bnkps.onnx"
    if dest.exists():
        print(f"[wav2lip] scrfd already present at {dest}")
        return
    url = os.environ.get(
        "SCRFD_URL",
        "https://raw.githubusercontent.com/zhangziliang04/wav2lip-onnx/"
        "master/insightface_func/models/antelope/scrfd_2.5g_bnkps.onnx",
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"[wav2lip] downloading SCRFD face detector -> {dest}")
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    dest.write_bytes(resp.content)
    print(f"[wav2lip] scrfd ready at {dest} ({dest.stat().st_size / 1e6:.1f} MB)")


RESTORATION_MODELS = {
    "gfpgan": {
        "repo_id": "DeepFakeApp/model",
        "filename": "GFPGANv1.4.onnx",
        "dest": MODELS_DIR / "restoration" / "gfpgan" / "GFPGANv1.4.onnx",
        "url_env": "GFPGAN_URL",
        "size_mb": 340,
    },
    "codeformer": {
        "repo_id": "bluefoxcreation/Codeformer-ONNX",
        "filename": "codeformer.onnx",
        "dest": MODELS_DIR / "restoration" / "codeformer" / "codeformer.onnx",
        "url_env": "CODEFORMER_URL",
        "size_mb": 377,
    },
}


def download_restoration(dry_run: bool = False) -> None:
    """Fetch the ONNX face-restoration checkpoints used by ai/enhancer.py.

    GFPGANv1.4 powers the live ROI restoration; CodeFormer powers the offline
    broadcast restoration. Both are ONNX so inference needs no torch.
    """
    if dry_run:
        for name, spec in RESTORATION_MODELS.items():
            print(
                f"[{name}] dry-run: {spec['filename']} (~{spec['size_mb']} MB) "
                f"from {spec['repo_id']} -> {spec['dest']}"
            )
        return

    from huggingface_hub import hf_hub_download

    for name, spec in RESTORATION_MODELS.items():
        dest = spec["dest"]
        if dest.exists():
            print(f"[{name}] already present at {dest}")
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        override = os.environ.get(spec["url_env"])
        if override:
            import requests

            print(f"[{name}] downloading {override} -> {dest}")
            resp = requests.get(override, timeout=600)
            resp.raise_for_status()
            dest.write_bytes(resp.content)
        else:
            print(
                f"[{name}] downloading {spec['filename']} from "
                f"{spec['repo_id']} -> {dest}"
            )
            hf_hub_download(
                repo_id=spec["repo_id"],
                filename=spec["filename"],
                local_dir=dest.parent,
            )
        print(f"[{name}] ready at {dest} ({dest.stat().st_size / 1e6:.0f} MB)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--models",
        nargs="+",
        choices=["gpt-sovits", "liveportrait", "wav2lip", "restoration", "all"],
        default=["all"],
        help="which model weights to download",
    )
    parser.add_argument(
        "--no-code",
        action="store_true",
        help="skip cloning the inference repos",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="only list files that would be downloaded",
    )
    args = parser.parse_args()

    names = [m for m in args.models if m != "all"] or list(HF_WEIGHTS)
    want_restoration = "restoration" in names or "all" in args.models
    names = [n for n in names if n in HF_WEIGHTS]

    if not args.no_code and not args.dry_run:
        for name in names:
            clone_repo(name)
    elif args.dry_run:
        print("[dry-run] repo cloning skipped")

    for name in names:
        download_weights(name, dry_run=args.dry_run)

    if want_restoration:
        download_restoration(dry_run=args.dry_run)

    if not args.dry_run:
        if "gpt-sovits" in names:
            setup_gpt_sovits_links()
            patch_g2pw_model_source()
    if "wav2lip" in names:
        setup_wav2lip_links()
        export_wav2lip_onnx()
        download_scrfd()
    if "wav2lip" in names or want_restoration:
        write_models_readme()
        print(
            "\nDone. Install the real-model dependencies (see README Phase 2), then run\n"
            "the worker natively with AI_MODE=real (see worker/.env.local.example)."
        )


if __name__ == "__main__":
    main()
