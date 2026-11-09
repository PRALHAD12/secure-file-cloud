"""Small SQLite log of uploads/downloads. The dashboard and performance page read real rows from here."""
import json
import sqlite3
from datetime import datetime, timezone


def _conn(path):
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    return c


def init(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with _conn(path) as c:
        c.execute("""CREATE TABLE IF NOT EXISTS activity(
            id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
            file_id TEXT, file_name TEXT, file_size INTEGER, segments INTEGER, metrics TEXT, detail TEXT)""")


def log(path, kind, status, file_id="", file_name="", file_size=0, segments=0, metrics=None, detail=""):
    with _conn(path) as c:
        c.execute("INSERT INTO activity(ts,kind,status,file_id,file_name,file_size,segments,metrics,detail) VALUES(?,?,?,?,?,?,?,?,?)",
                  (datetime.now(timezone.utc).isoformat(timespec="seconds"), kind, status, file_id, file_name,
                   file_size, segments, json.dumps(metrics or {}), detail[:300]))


def _row(r):
    d = dict(r)
    d["metrics"] = json.loads(d["metrics"] or "{}")
    return d


def recent(path, limit=10):
    with _conn(path) as c:
        return [_row(r) for r in c.execute("SELECT * FROM activity ORDER BY id DESC LIMIT ?", (limit,))]


def counts(path):
    with _conn(path) as c:
        rows = c.execute("SELECT kind,status,COUNT(*) n FROM activity GROUP BY kind,status").fetchall()
    out = {"uploads_ok": 0, "uploads_failed": 0, "downloads_ok": 0, "downloads_failed": 0}
    for r in rows:
        out[f"{r['kind']}s_{'ok' if r['status'] == 'success' else 'failed'}"] = r["n"]
    return out


def performance(path, limit=30):
    with _conn(path) as c:
        return [_row(r) for r in c.execute(
            "SELECT * FROM activity WHERE status='success' AND metrics!='{}' ORDER BY id DESC LIMIT ?", (limit,))]
