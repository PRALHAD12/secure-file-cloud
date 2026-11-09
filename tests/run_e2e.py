"""Starts the backend in LOCAL mode on a free port, runs tests/e2e.mjs (needs Node.js 18+), then stops it."""
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
data = tempfile.mkdtemp()
env = dict(os.environ, STORAGE_BACKEND="local", DATA_DIR=data, PORT=str(port), HOST="127.0.0.1", PRESIGN_EXPIRY_SECONDS="600")
server = subprocess.Popen([sys.executable, "-m", "backend.app"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1); break
        except Exception:
            time.sleep(0.2)
    else:
        sys.exit("Server did not start")
    code = subprocess.call(["node", "tests/e2e.mjs"], cwd=ROOT, env=dict(env, SFS_URL=f"http://127.0.0.1:{port}", SFS_DATA_DIR=data))
finally:
    server.terminate()
sys.exit(code)
