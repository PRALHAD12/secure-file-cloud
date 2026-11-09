"""Object-storage layer.

S3Storage    -> real Amazon S3 through boto3 (presigned URLs for browser <-> S3 transfers).
LocalStorage -> folder on disk with HMAC-signed URLs. For offline development and automated
                tests ONLY. It behaves like S3 for the app, but it is NOT cloud storage.
"""
import hashlib
import hmac
import time
from pathlib import Path
from urllib.parse import quote

OCTET = "application/octet-stream"


class StorageError(Exception):
    pass


class S3Storage:
    mode = "s3"

    def __init__(self, bucket, region, expiry):
        if not bucket:
            raise StorageError("S3_DATA_BUCKET is not set. Edit your .env file.")
        import boto3
        from botocore.config import Config
        self.bucket, self.region, self.expiry = bucket, region, expiry
        # Signature V4 + regional endpoint => presigned URLs work in every region.
        self.client = boto3.client("s3", region_name=region, config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}))

    def presign(self, method, key, base_url=None):
        op = "put_object" if method == "PUT" else "get_object"
        params = {"Bucket": self.bucket, "Key": key}
        if method == "PUT":
            params["ContentType"] = OCTET  # the browser must send the same header
        return self.client.generate_presigned_url(op, Params=params, ExpiresIn=self.expiry)

    def put_object(self, key, data, content_type=OCTET):
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    def get_object(self, key):
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def head(self, key):
        from botocore.exceptions import ClientError
        try:
            return self.client.head_object(Bucket=self.bucket, Key=key)["ContentLength"]
        except ClientError as e:
            if e.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
                return None
            raise

    def list(self, prefix):
        out = []
        for page in self.client.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=prefix):
            out += [(o["Key"], o["Size"]) for o in page.get("Contents", [])]
        return out

    def delete_prefix(self, prefix):
        keys = [{"Key": k} for k, _ in self.list(prefix)]
        for i in range(0, len(keys), 1000):
            self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": keys[i:i + 1000]})
        return len(keys)

    def check(self):
        try:
            self.client.head_bucket(Bucket=self.bucket)
            return True, f"Connected to S3 bucket '{self.bucket}' ({self.region})"
        except Exception as e:  # noqa: BLE001 - show a readable reason on the dashboard
            return False, f"Cannot reach bucket '{self.bucket}': {e.__class__.__name__}"


class LocalStorage:
    mode = "local"

    def __init__(self, root, secret, expiry):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.secret, self.expiry = secret.encode(), expiry

    def _path(self, key):
        p = (self.root / key).resolve()
        if self.root not in p.parents:
            raise StorageError("Invalid object key")
        return p

    def _sig(self, method, key, exp):
        return hmac.new(self.secret, f"{method}\n{key}\n{exp}".encode(), hashlib.sha256).hexdigest()

    def presign(self, method, key, base_url=""):
        exp = int(time.time()) + self.expiry
        return f"{base_url.rstrip('/')}/local-storage/{quote(key)}?exp={exp}&sig={self._sig(method, key, exp)}"

    def verify(self, method, key, exp, sig):
        try:
            return int(exp) >= time.time() and hmac.compare_digest(sig or "", self._sig(method, key, int(exp)))
        except (TypeError, ValueError):
            return False

    def put_object(self, key, data, content_type=OCTET):
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def get_object(self, key):
        return self._path(key).read_bytes()

    def head(self, key):
        p = self._path(key)
        return p.stat().st_size if p.is_file() else None

    def list(self, prefix):
        return [(p.relative_to(self.root).as_posix(), p.stat().st_size)
                for p in sorted(self.root.rglob("*")) if p.is_file() and p.relative_to(self.root).as_posix().startswith(prefix)]

    def delete_prefix(self, prefix):
        items = self.list(prefix)
        for k, _ in items:
            self._path(k).unlink()
        return len(items)

    def check(self):
        return True, "Local development storage (not AWS)"


def make_storage(cfg):
    if cfg.storage_backend == "local":
        return LocalStorage(cfg.data_dir / "local_storage", cfg.signing_secret, cfg.presign_expiry)
    return S3Storage(cfg.data_bucket, cfg.aws_region, cfg.presign_expiry)
