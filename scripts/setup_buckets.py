"""Creates the two PRIVATE S3 buckets (data + website) with safe settings.

    python scripts/setup_buckets.py [--origin https://dxxxx.cloudfront.net]

Reads S3_DATA_BUCKET, S3_SITE_BUCKET, AWS_REGION, ALLOWED_ORIGINS from .env.
Settings applied: Block Public Access (all 4), default encryption (SSE-S3), HTTPS-only policy and
browser CORS rules (data bucket). You still create the CloudFront distribution yourself (see README).
"""
import argparse
import json
import os
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass
import boto3
from botocore.exceptions import ClientError


def make_bucket(s3, name, region):
    kw = {} if region == "us-east-1" else {"CreateBucketConfiguration": {"LocationConstraint": region}}
    try:
        s3.create_bucket(Bucket=name, **kw)
        print(f"created bucket {name}")
    except ClientError as e:
        if e.response["Error"]["Code"] != "BucketAlreadyOwnedByYou":
            sys.exit(f"Could not create {name}: {e.response['Error']['Message']}")
        print(f"bucket {name} already exists (kept)")
    s3.put_public_access_block(Bucket=name, PublicAccessBlockConfiguration={
        "BlockPublicAcls": True, "IgnorePublicAcls": True, "BlockPublicPolicy": True, "RestrictPublicBuckets": True})
    s3.put_bucket_encryption(Bucket=name, ServerSideEncryptionConfiguration={
        "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]})
    s3.put_bucket_policy(Bucket=name, Policy=json.dumps({"Version": "2012-10-17", "Statement": [{
        "Sid": "DenyInsecureTransport", "Effect": "Deny", "Principal": "*", "Action": "s3:*",
        "Resource": [f"arn:aws:s3:::{name}", f"arn:aws:s3:::{name}/*"], "Condition": {"Bool": {"aws:SecureTransport": "false"}}}]}))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--origin", action="append", default=[], help="extra allowed website origin (repeatable)")
    a = ap.parse_args()
    region, data, site = os.getenv("AWS_REGION", "ap-south-1"), os.getenv("S3_DATA_BUCKET"), os.getenv("S3_SITE_BUCKET")
    if not data or not site:
        sys.exit("Set S3_DATA_BUCKET and S3_SITE_BUCKET in your .env file first.")
    s3 = boto3.client("s3", region_name=region)
    make_bucket(s3, data, region)
    make_bucket(s3, site, region)
    origins = [o for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()] + a.origin
    s3.put_bucket_cors(Bucket=data, CORSConfiguration={"CORSRules": [{
        "AllowedOrigins": sorted(set(origins)), "AllowedMethods": ["GET", "PUT"], "AllowedHeaders": ["*"],
        "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3000}]})
    print(f"CORS set on {data} for: {', '.join(sorted(set(origins)))}")
    print("\nDone. Both buckets are private. Next: create the CloudFront distribution (README, step 7).")


if __name__ == "__main__":
    main()
