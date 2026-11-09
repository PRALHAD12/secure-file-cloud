"""Application settings, read from environment variables (.env file supported)."""
import os
from dataclasses import dataclass, field
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:  # python-dotenv is optional
    pass

ROOT = Path(__file__).resolve().parent.parent
MB = 1024 * 1024


def _int(name, default):
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return int(default)


@dataclass
class Settings:
    storage_backend: str = field(default_factory=lambda: os.getenv("STORAGE_BACKEND", "s3").lower())
    aws_region: str = field(default_factory=lambda: os.getenv("AWS_REGION", "ap-south-1"))
    data_bucket: str = field(default_factory=lambda: os.getenv("S3_DATA_BUCKET", ""))
    cloudfront_domain: str = field(default_factory=lambda: os.getenv("CLOUDFRONT_DOMAIN", ""))
    presign_expiry: int = field(default_factory=lambda: _int("PRESIGN_EXPIRY_SECONDS", 600))
    segment_size: int = field(default_factory=lambda: _int("SEGMENT_SIZE_MB", 5) * MB)
    max_file_size: int = field(default_factory=lambda: _int("MAX_FILE_MB", 500) * MB)
    allowed_origins: list = field(default_factory=lambda: [
        o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5000,http://127.0.0.1:5000").split(",") if o.strip()])
    signing_secret: str = field(default_factory=lambda: os.getenv("LOCAL_SIGNING_SECRET", "dev-only-secret"))
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("DATA_DIR", ROOT / "backend" / "data")))
    frontend_dir: Path = ROOT / "frontend"

    # Limits for the upload API (the browser may choose a segment size inside these limits)
    min_segment_size: int = 64 * 1024
    max_segment_size: int = 64 * MB
    max_segments: int = 10000
