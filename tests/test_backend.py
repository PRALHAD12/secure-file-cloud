"""Backend unit tests (standard library unittest).  Run:  python -m unittest discover -s tests -v"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

os.environ["STORAGE_BACKEND"] = "local"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.app import create_app  # noqa: E402
from backend.config import Settings  # noqa: E402


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        cfg = Settings(data_dir=Path(self.tmp))
        cfg.segment_size = 1024 * 1024
        self.app = create_app(cfg)
        self.c = self.app.test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def init(self, size=2500, seg=65536, name="a.txt"):
        r = self.c.post("/api/upload/init", json={"filename": name, "size": size, "segment_size": seg})
        return r

    def put(self, url, data):
        path = url.split("http://localhost", 1)[-1]
        return self.c.put(path, data=data)

    def full_upload(self, size=200000, seg=65536):
        j = self.init(size, seg).get_json()
        for u in j["uploads"]:
            plain = min(seg, size - u["index"] * seg)
            self.assertEqual(self.put(u["url"], os.urandom(plain + 28)).status_code, 200)
        return j, self.c.post("/api/upload/complete", json={"file_id": j["file_id"], "filename": "a.txt", "size": size,
                                                            "segment_size": seg, "metrics": {"upload_ms": 12.5, "evil": 1}})

    def test_init_validation(self):
        self.assertEqual(self.c.post("/api/upload/init", json={"filename": "a", "size": 0}).status_code, 400)
        self.assertEqual(self.c.post("/api/upload/init", json={"filename": "a", "size": 10**12}).status_code, 400)
        self.assertEqual(self.c.post("/api/upload/init", json={"filename": "", "size": 10}).status_code, 400)
        self.assertEqual(self.c.post("/api/upload/init", json={"filename": "a", "size": 10, "segment_size": 5}).status_code, 400)
        self.assertEqual(self.c.post("/api/upload/init", json={"filename": "a", "size": True}).status_code, 400)

    def test_init_segment_names_and_count(self):
        j = self.init(size=200000, seg=65536).get_json()
        self.assertEqual(j["segment_count"], 4)
        self.assertEqual([u["name"] for u in j["uploads"]], [f"part{i:05d}.enc" for i in range(4)])

    def test_filename_is_sanitised(self):
        j = self.init(name="../../etc/pass\\wd.txt").get_json()
        self.assertIn("file_id", j)
        j2, r = self.full_upload()
        self.assertEqual(r.status_code, 201)

    def test_full_flow_list_stats_download_delete(self):
        j, r = self.full_upload()
        self.assertEqual(r.status_code, 201)
        m = r.get_json()
        self.assertEqual(m["segment_count"], 4)
        self.assertEqual(m["total_encrypted_size"], 200000 + 4 * 28)
        self.assertEqual(len(self.c.get("/api/files").get_json()["files"]), 1)
        st = self.c.get("/api/stats").get_json()
        self.assertEqual((st["total_files"], st["total_segments"], st["uploads_ok"]), (1, 4, 1))
        d = self.c.get(f"/api/files/{m['file_id']}").get_json()
        got = self.c.get(d["downloads"][0]["url"].split("http://localhost", 1)[-1])
        self.assertEqual(got.status_code, 200)
        self.c.post(f"/api/files/{m['file_id']}/download-result", json={"status": "success", "metrics": {"decrypt_ms": 3}})
        self.c.post(f"/api/files/{m['file_id']}/download-result", json={"status": "failed", "error": "bad key"})
        st = self.c.get("/api/stats").get_json()
        self.assertEqual((st["downloads_ok"], st["downloads_failed"]), (1, 1))
        self.assertEqual(self.c.delete(f"/api/files/{m['file_id']}").status_code, 200)
        self.assertEqual(self.c.get("/api/stats").get_json()["total_files"], 0)

    def test_metrics_whitelist(self):
        self.full_upload()
        rec = self.c.get("/api/performance").get_json()["records"][0]
        self.assertEqual(rec["metrics"], {"upload_ms": 12.5})

    def test_complete_rejects_wrong_size_and_cleans_up(self):
        j = self.init(size=100000, seg=65536).get_json()
        self.put(j["uploads"][0]["url"], os.urandom(65536 + 28))
        self.put(j["uploads"][1]["url"], os.urandom(10))                      # wrong size
        r = self.c.post("/api/upload/complete", json={"file_id": j["file_id"], "filename": "a", "size": 100000, "segment_size": 65536})
        self.assertEqual(r.status_code, 422)
        self.assertEqual(self.app.extensions["storage"].list(f"uploads/{j['file_id']}/"), [])
        self.assertEqual(self.c.get("/api/stats").get_json()["uploads_failed"], 1)

    def test_complete_rejects_missing_segment_and_duplicates(self):
        j = self.init(size=100000, seg=65536).get_json()
        self.put(j["uploads"][0]["url"], os.urandom(65536 + 28))
        r = self.c.post("/api/upload/complete", json={"file_id": j["file_id"], "filename": "a", "size": 100000, "segment_size": 65536})
        self.assertEqual(r.status_code, 422)
        j, r = self.full_upload()
        r2 = self.c.post("/api/upload/complete", json={"file_id": j["file_id"], "filename": "a.txt", "size": 200000, "segment_size": 65536})
        self.assertEqual(r2.status_code, 409)

    def test_signed_urls_are_enforced(self):
        j = self.init().get_json()
        path = j["uploads"][0]["url"].split("http://localhost", 1)[-1]
        self.assertEqual(self.c.put(path.split("sig=")[0] + "sig=bad", data=b"x").status_code, 403)
        self.assertEqual(self.c.put("/local-storage/uploads/x/y.enc", data=b"x").status_code, 403)
        self.assertEqual(self.c.put(path.replace("exp=", "exp=1"), data=b"x").status_code, 403)

    def test_bad_ids_and_unknown_routes(self):
        self.assertEqual(self.c.get("/api/files/../../etc").status_code, 404)
        self.assertEqual(self.c.get("/api/files/" + "g" * 32).status_code, 404)
        self.assertEqual(self.c.post("/api/upload/complete", json={"file_id": "nope"}).status_code, 400)

    def test_cors_only_for_allowed_origins(self):
        ok = self.c.get("/api/health", headers={"Origin": "http://localhost:5000"})
        bad = self.c.get("/api/health", headers={"Origin": "http://evil.example"})
        self.assertEqual(ok.headers.get("Access-Control-Allow-Origin"), "http://localhost:5000")
        self.assertIsNone(bad.headers.get("Access-Control-Allow-Origin"))

    def test_api_never_returns_key_material_fields(self):
        j, r = self.full_upload()
        text = json.dumps(r.get_json()).lower() + json.dumps(self.c.get(f"/api/files/{j['file_id']}").get_json()).lower()
        self.assertNotIn('"key"', text)


if __name__ == "__main__":
    unittest.main()
