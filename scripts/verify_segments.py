"""Independent Python decryptor (same algorithm as the report's source code).

Use it to prove that segments written by the browser can be decrypted by plain Python:
    python scripts/verify_segments.py <folder with part00000.enc ...> <key file or base64 key> <output file>
Layout of each segment: nonce(12) || ciphertext || tag(16); AAD = segment index as decimal text.
"""
import base64
import json
import sys
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def load_key(arg):
    text = Path(arg).read_text().strip() if Path(arg).is_file() else arg.strip()
    if text.startswith("{"):
        text = json.loads(text)["key"]
    return base64.b64decode(text.replace("-", "+").replace("_", "/"))


def decrypt_merge(folder, key, out_path):
    aes = AESGCM(key)
    parts = sorted(Path(folder).glob("part*.enc"))
    if not parts:
        raise SystemExit("No part*.enc files found")
    with open(out_path, "wb") as out:
        for i, p in enumerate(parts):
            if p.name != f"part{i:05d}.enc":
                raise SystemExit(f"Segment order problem: expected part{i:05d}.enc, found {p.name}")
            data = p.read_bytes()
            try:
                out.write(aes.decrypt(data[:12], data[12:], str(i).encode()))
            except InvalidTag:
                raise SystemExit(f"FAILED: segment {i} did not authenticate (wrong key or modified data)")
    return len(parts)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    n = decrypt_merge(sys.argv[1], load_key(sys.argv[2]), sys.argv[3])
    print(f"OK: {n} segments decrypted and merged into {sys.argv[3]}")
