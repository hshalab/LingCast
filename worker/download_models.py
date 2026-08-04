#!/usr/bin/env python3
"""Download the code and weights needed by the hybrid real-model worker.

Fetches:
  - GPT-SoVITS  (code: RVC-Boss/GPT-SoVITS, weights: lj1995/GPT-SoVITS)
  - LivePortrait (code: KwaiVGI/LivePortrait, weights: KwaiVGI/LivePortrait HF)

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

Usage:
  python download_models.py --models all            # code + weights
  python download_models.py --models liveportrait   # only LivePortrait
  python download_models.py --dry-run               # show what would download
  HF_ENDPOINT=https://hf-mirror.com python download_models.py   # CN mirror
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

    python worker/download_models.py --models all

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

Optional (Chinese TTS polyphone quality): download G2PWModel.zip from the
GPT-SoVITS docs and unpack it to
worker/external/GPT-SoVITS/GPT_SoVITS/text/G2PWModel.
""",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--models",
        nargs="+",
        choices=["gpt-sovits", "liveportrait", "all"],
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

    if not args.no_code and not args.dry_run:
        for name in names:
            clone_repo(name)
    elif args.dry_run:
        print("[dry-run] repo cloning skipped")

    for name in names:
        download_weights(name, dry_run=args.dry_run)

    if not args.dry_run:
        write_models_readme()
        print(
            "\nDone. Install the real-model dependencies (see README Phase 2), then run\n"
            "the worker natively with AI_MODE=real (see worker/.env.local.example)."
        )


if __name__ == "__main__":
    main()
