"""Uploads the frontend/ folder to the private website bucket and (optionally) clears the CloudFront cache.

    python scripts/deploy_site.py --api-base http://localhost:5000 --invalidate

--api-base  address of the Flask backend that the deployed website should call (written into config.js
            in the uploaded copy only; your local frontend/config.js is not changed)
--delete    remove files from the bucket that no longer exist in frontend/
--dry-run   show what would happen without uploading
"""
import argparse
import json
import mimetypes
import os
import sys
import time
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass
import boto3

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "frontend"
TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".json": "application/json", ".svg": "image/svg+xml"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bucket", default=os.getenv("S3_SITE_BUCKET"))
    ap.add_argument("--distribution", default=os.getenv("CLOUDFRONT_DISTRIBUTION_ID"))
    ap.add_argument("--api-base", default=None)
    ap.add_argument("--invalidate", action="store_true")
    ap.add_argument("--delete", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if not a.bucket:
        sys.exit("Set S3_SITE_BUCKET in .env or pass --bucket")

    files = {}
    for p in sorted(SITE.rglob("*")):
        if p.is_file():
            key, body = p.relative_to(SITE).as_posix(), p.read_bytes()
            if key == "config.js" and a.api_base is not None:
                body = f"window.SFS_CONFIG = {{ API_BASE: {json.dumps(a.api_base)} }};\n".encode()
            files[key] = body
    for need in ("index.html", "error.html"):
        if need not in files:
            sys.exit(f"{need} is missing from frontend/")

    s3 = boto3.client("s3", region_name=os.getenv("AWS_REGION"))
    for key, body in files.items():
        ctype = TYPES.get(Path(key).suffix) or mimetypes.guess_type(key)[0] or "application/octet-stream"
        cache = "public, max-age=300" if key.endswith(".html") or key == "config.js" else "public, max-age=86400"
        print(f"{'would upload' if a.dry_run else 'upload'}  {key}  ({ctype}, {cache})")
        if not a.dry_run:
            s3.put_object(Bucket=a.bucket, Key=key, Body=body, ContentType=ctype, CacheControl=cache)
    if a.delete and not a.dry_run:
        for page in s3.get_paginator("list_objects_v2").paginate(Bucket=a.bucket):
            for o in page.get("Contents", []):
                if o["Key"] not in files:
                    s3.delete_object(Bucket=a.bucket, Key=o["Key"]); print("deleted", o["Key"])
    if a.invalidate and not a.dry_run:
        if not a.distribution:
            sys.exit("Set CLOUDFRONT_DISTRIBUTION_ID in .env or pass --distribution")
        r = boto3.client("cloudfront").create_invalidation(DistributionId=a.distribution, InvalidationBatch={
            "Paths": {"Quantity": 1, "Items": ["/*"]}, "CallerReference": str(time.time())})
        print("invalidation started:", r["Invalidation"]["Id"])
    print("Done.")


if __name__ == "__main__":
    main()
