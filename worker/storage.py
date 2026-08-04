import logging
import os
from pathlib import Path

import boto3
from botocore.client import Config

logger = logging.getLogger(__name__)


class S3Storage:
    """boto3 client pointed at the RustFS (S3-compatible) endpoint."""

    def __init__(self):
        self.bucket = os.environ["S3_BUCKET"]
        self.public_base_url = os.environ.get("S3_PUBLIC_BASE_URL", "").rstrip("/")
        self.client = boto3.client(
            "s3",
            endpoint_url=os.environ["S3_ENDPOINT"],
            aws_access_key_id=os.environ["S3_ACCESS_KEY"],
            aws_secret_access_key=os.environ["S3_SECRET_KEY"],
            region_name=os.environ.get("S3_REGION", "us-east-1"),
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
            ),
        )

    def download(self, key: str, dest: Path) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        self.client.download_file(self.bucket, key, str(dest))
        logger.info("downloaded s3://%s/%s -> %s", self.bucket, key, dest)

    def upload(self, key: str, src: Path, content_type: str = "video/mp4") -> None:
        self.client.upload_file(
            str(src),
            self.bucket,
            key,
            ExtraArgs={"ContentType": content_type},
        )
        logger.info("uploaded %s -> s3://%s/%s", src, self.bucket, key)

    def public_url(self, key: str) -> str:
        if not self.public_base_url:
            raise RuntimeError("S3_PUBLIC_BASE_URL is not configured")
        return f"{self.public_base_url}/{self.bucket}/{key}"

    def presigned_url(self, key: str, expires_in: int = 3600) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires_in,
        )

    def url_for(self, key: str) -> str:
        """Prefer a stable public URL; fall back to a presigned URL when no
        public base URL is configured (e.g. direct RustFS access)."""
        if self.public_base_url:
            return self.public_url(key)
        return self.presigned_url(key)
