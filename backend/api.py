"""REST API. The backend NEVER receives file contents or encryption keys:
it only hands out short-lived presigned URLs, verifies what was stored, and keeps a manifest."""
import json
import math
import re
import uuid
from datetime import datetime, timezone
from pathlib import PurePosixPath

from flask import Blueprint, current_app, jsonify, request

from . import activity
from .storage import OCTET

bp = Blueprint("api", __name__)
ID_RE = re.compile(r"^[0-9a-f]{32}$")
OVERHEAD = 28  # 12-byte nonce + 16-byte GCM tag added to every segment
MB = 1024 * 1024
METRIC_KEYS = ("segment_ms", "encrypt_ms", "upload_ms", "download_ms", "decrypt_ms", "reconstruct_ms", "total_ms")


def cfg():
    return current_app.config["SFS"]


def store():
    return current_app.extensions["storage"]


def db():
    return cfg().data_dir / "activity.db"


def err(msg, code=400):
    return jsonify(error=msg), code


def prefix(fid):
    return f"uploads/{fid}/"


def seg_name(i):
    return f"part{i:05d}.enc"


def clean_name(name):
    name = PurePosixPath(str(name or "").replace("\\", "/")).name
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip()
    return name[:255]


def parse_params(d):
    """Validate the upload parameters sent by the browser."""
    c = cfg()
    name = clean_name(d.get("filename"))
    size, seg = d.get("size"), d.get("segment_size", c.segment_size)
    if not name:
        raise ValueError("Invalid file name")
    if not isinstance(size, int) or isinstance(size, bool) or size < 1:
        raise ValueError("The file is empty or its size is invalid")
    if size > c.max_file_size:
        raise ValueError(f"File is larger than the {c.max_file_size // MB} MB limit")
    if not isinstance(seg, int) or isinstance(seg, bool) or not c.min_segment_size <= seg <= c.max_segment_size:
        raise ValueError("Segment size is outside the allowed range")
    count = math.ceil(size / seg)
    if count > c.max_segments:
        raise ValueError("Too many segments; choose a larger segment size")
    return name, size, seg, count, str(d.get("content_type") or OCTET)[:100]


def clean_metrics(m):
    m = m if isinstance(m, dict) else {}
    return {k: round(float(m[k]), 2) for k in METRIC_KEYS if isinstance(m.get(k), (int, float)) and not isinstance(m.get(k), bool)}


def read_manifest(fid):
    key = prefix(fid) + "manifest.json"
    if not ID_RE.match(fid) or store().head(key) is None:
        return None
    return json.loads(store().get_object(key))


def all_manifests():
    out = []
    for key, _ in store().list("uploads/"):
        if key.endswith("/manifest.json"):
            try:
                out.append(json.loads(store().get_object(key)))
            except ValueError:
                continue
    return sorted(out, key=lambda m: m["created_at"], reverse=True)


def summary(m):
    return {k: m[k] for k in ("file_id", "file_name", "file_size", "file_type", "segment_size",
                              "segment_count", "total_encrypted_size", "created_at")}


@bp.get("/api/health")
def health():
    c = cfg()
    ok, detail = store().check()
    return jsonify(status="ok", cloud_ok=ok, detail=detail, storage_mode=store().mode,
                   bucket=c.data_bucket if store().mode == "s3" else None, region=c.aws_region,
                   cloudfront_domain=c.cloudfront_domain or None, segment_size=c.segment_size,
                   max_file_size=c.max_file_size, presign_expiry=c.presign_expiry)


@bp.post("/api/upload/init")
def upload_init():
    try:
        name, size, seg, count, _ = parse_params(request.get_json(silent=True) or {})
    except ValueError as e:
        return err(str(e))
    fid = uuid.uuid4().hex
    uploads = [{"index": i, "name": seg_name(i), "url": store().presign("PUT", prefix(fid) + seg_name(i), request.host_url)}
               for i in range(count)]
    return jsonify(file_id=fid, segment_size=seg, segment_count=count, expires_in=cfg().presign_expiry,
                   upload_headers={"Content-Type": OCTET}, uploads=uploads)


@bp.post("/api/upload/complete")
def upload_complete():
    d = request.get_json(silent=True) or {}
    fid = str(d.get("file_id", ""))
    if not ID_RE.match(fid):
        return err("Invalid file id")
    try:
        name, size, seg, count, ctype = parse_params(d)
    except ValueError as e:
        return err(str(e))
    s = store()
    if s.head(prefix(fid) + "manifest.json") is not None:
        return err("This upload was already completed", 409)
    found = dict(s.list(prefix(fid)))
    segments, problems = [], []
    for i in range(count):
        plain = min(seg, size - i * seg)
        key, expected = prefix(fid) + seg_name(i), plain + OVERHEAD
        if key not in found:
            problems.append(f"{seg_name(i)} is missing")
        elif found[key] != expected:
            problems.append(f"{seg_name(i)} has {found[key]} bytes, expected {expected}")
        segments.append({"index": i, "name": seg_name(i), "plain_size": plain, "encrypted_size": expected})
    if problems:
        s.delete_prefix(prefix(fid))
        activity.log(db(), "upload", "failed", fid, name, size, count, detail="; ".join(problems[:3]))
        return err("Upload verification failed: " + "; ".join(problems[:3]), 422)
    manifest = {
        "version": 1, "file_id": fid, "file_name": name, "file_size": size, "file_type": ctype,
        "segment_size": seg, "segment_count": count, "total_encrypted_size": size + count * OVERHEAD,
        "encryption": {"algorithm": "AES-256-GCM", "nonce_bytes": 12, "tag_bytes": 16,
                       "aad": "segment index as decimal ASCII text", "layout": "nonce || ciphertext || tag"},
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "segments": segments,
    }
    s.put_object(prefix(fid) + "manifest.json", json.dumps(manifest).encode(), "application/json")
    activity.log(db(), "upload", "success", fid, name, size, count, clean_metrics(d.get("metrics")))
    return jsonify(manifest), 201


@bp.post("/api/upload/fail")
def upload_fail():
    d = request.get_json(silent=True) or {}
    fid = str(d.get("file_id", ""))
    if ID_RE.match(fid) and store().head(prefix(fid) + "manifest.json") is None:
        store().delete_prefix(prefix(fid))  # remove half-uploaded segments
    activity.log(db(), "upload", "failed", fid, clean_name(d.get("filename")), int(d.get("size") or 0),
                 detail=str(d.get("error", ""))[:300])
    return jsonify(ok=True)


@bp.get("/api/files")
def list_files():
    return jsonify(files=[summary(m) for m in all_manifests()])


@bp.get("/api/files/<fid>")
def file_details(fid):
    m = read_manifest(fid)
    if not m:
        return err("File not found", 404)
    downloads = [{"index": s_["index"], "url": store().presign("GET", prefix(fid) + s_["name"], request.host_url)}
                 for s_ in m["segments"]]
    return jsonify(manifest=m, downloads=downloads, expires_in=cfg().presign_expiry)


@bp.post("/api/files/<fid>/download-result")
def download_result(fid):
    d = request.get_json(silent=True) or {}
    m = read_manifest(fid) or {}
    ok = d.get("status") == "success"
    activity.log(db(), "download", "success" if ok else "failed", fid, m.get("file_name", ""), m.get("file_size", 0),
                 m.get("segment_count", 0), clean_metrics(d.get("metrics")) if ok else {}, str(d.get("error", "")))
    return jsonify(ok=True)


@bp.delete("/api/files/<fid>")
def delete_file(fid):
    m = read_manifest(fid)
    if not m:
        return err("File not found", 404)
    store().delete_prefix(prefix(fid))
    activity.log(db(), "delete", "success", fid, m["file_name"], m["file_size"], m["segment_count"])
    return jsonify(ok=True)


@bp.get("/api/stats")
def stats():
    ms = all_manifests()
    return jsonify(total_files=len(ms), total_segments=sum(m["segment_count"] for m in ms),
                   storage_bytes=sum(m["total_encrypted_size"] for m in ms),
                   original_bytes=sum(m["file_size"] for m in ms), **activity.counts(db()))


@bp.get("/api/activity")
def get_activity():
    limit = max(1, min(request.args.get("limit", 10, type=int), 100))
    return jsonify(activity=activity.recent(db(), limit))


@bp.get("/api/performance")
def get_performance():
    return jsonify(records=activity.performance(db()))
