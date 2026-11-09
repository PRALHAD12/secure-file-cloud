// End-to-end test: runs the REAL browser modules (crypto.js, transfer.js) in Node against a live backend.
// Usage: SFS_URL=http://127.0.0.1:5055 SFS_DATA_DIR=<backend data dir> node tests/e2e.mjs
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync, renameSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApi } from "../frontend/js/api.js";
import { uploadFile, downloadFile } from "../frontend/js/transfer.js";
import { parseKeyInput, DecryptError } from "../frontend/js/crypto.js";

const URL_ = process.env.SFS_URL, STORE = join(process.env.SFS_DATA_DIR, "local_storage", "uploads");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const api = createApi(URL_);
const sha = (u8) => createHash("sha256").update(u8).digest("hex");
const MB = 1024 * 1024, results = [];
const MARKER = "TOP-SECRET-PLAINTEXT-MARKER-0123456789";

async function test(name, fn) {
  try { const detail = await fn(); results.push([name, true, detail || ""]); console.log(`PASS  ${name}${detail ? "  -> " + detail : ""}`); }
  catch (e) { results.push([name, false, e.message]); console.log(`FAIL  ${name}  -> ${e.message}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
async function rejects(p, cls, msg) {
  try { await p; } catch (e) { assert(!cls || e instanceof cls, `wrong error type: ${e.name}: ${e.message}`); assert(!msg || e.message.includes(msg), `unexpected message: ${e.message}`); return e.message; }
  throw new Error("expected an error but the operation succeeded (an invalid file would have been produced)");
}
function makeFile(size, name) {
  const buf = randomBytes(size); Buffer.from(MARKER).copy(buf, 0);
  if (size > 100) Buffer.from(MARKER).copy(buf, size - MARKER.length);
  return { buf, file: Object.assign(new Blob([buf], { type: "application/octet-stream" }), { name }) };
}
const segFiles = (id) => readdirSync(join(STORE, id)).filter((f) => f.endsWith(".enc")).sort();

const big = makeFile(12 * MB + 345678, "big-12.3MB.bin");    // 3 segments (5 + 5 + ~2.3 MB)
const small = makeFile(1500, "small.txt");                   // 1 segment
const exact = makeFile(10 * MB, "exact-10MB.bin");           // exactly 2 full segments
const one = makeFile(1, "one-byte.bin");                     // smallest possible file
const up = {};

for (const [label, f] of [["big", big], ["small", small], ["exact", exact], ["one", one]]) {
  await test(`Upload + segmentation + encryption: ${label} (${f.file.size} bytes)`, async () => {
    const seen = [];
    up[label] = await uploadFile({ api, file: f.file, segmentSize: 5 * MB, onSegment: (s) => seen.push(s.status) });
    const m = up[label].manifest, expected = Math.ceil(f.file.size / (5 * MB));
    assert(m.segment_count === expected, `segment count ${m.segment_count} != ${expected}`);
    assert(JSON.stringify(segFiles(m.file_id)) === JSON.stringify(Array.from({ length: expected }, (_, i) => `part${String(i).padStart(5, "0")}.enc`)), "segment names are not sequential");
    let total = 0;
    for (const s of m.segments) { const sz = statSync(join(STORE, m.file_id, s.name)).size; assert(sz === s.plain_size + 28, `${s.name} size ${sz}`); total += sz; }
    assert(total === f.file.size + expected * 28, "total encrypted size wrong");
    return `${expected} segment(s), ${total} bytes stored (overhead ${expected * 28} B)`;
  });
}

await test("Only encrypted data stored: plaintext marker not found in any stored object", async () => {
  let checked = 0;
  for (const label of ["big", "small", "exact"]) {
    const id = up[label].manifest.file_id;
    for (const f of readdirSync(join(STORE, id))) {
      const data = readFileSync(join(STORE, id, f)); checked++;
      assert(!data.includes(MARKER), `plaintext found in ${f}`);
      if (f === "manifest.json") { assert(!data.includes(up[label].keyB64), "key found in manifest"); }
    }
  }
  return `${checked} stored objects scanned`;
});

await test("Encryption key is not sent to / stored by the server (scan all stored files + activity DB)", async () => {
  const dbBytes = readFileSync(join(process.env.SFS_DATA_DIR, "activity.db"));
  for (const label of Object.keys(up)) {
    const k = up[label].keyB64, hex = Buffer.from(k, "base64").toString("hex");
    assert(!dbBytes.includes(k) && !dbBytes.includes(hex), "key in activity DB");
    for (const f of readdirSync(join(STORE, up[label].manifest.file_id))) { const d = readFileSync(join(STORE, up[label].manifest.file_id, f)); assert(!d.includes(k) && !d.includes(Buffer.from(k, "base64")), "key in storage"); }
  }
});

await test("Each segment uses a unique nonce (all nonces across all segments distinct)", async () => {
  const nonces = new Set(); let n = 0;
  for (const label of ["big", "exact", "small"]) for (const f of segFiles(up[label].manifest.file_id)) { nonces.add(readFileSync(join(STORE, up[label].manifest.file_id, f)).subarray(0, 12).toString("hex")); n++; }
  assert(nonces.size === n, "duplicate nonce found"); return `${n} nonces, all unique`;
});

for (const [label, f] of [["big", big], ["small", small], ["exact", exact], ["one", one]]) {
  await test(`Download + decrypt + merge + compare: ${label}`, async () => {
    const r = await downloadFile({ api, fileId: up[label].manifest.file_id, keyText: JSON.stringify(up[label].keyFile) });
    const out = new Uint8Array(await r.blob.arrayBuffer());
    assert(sha(out) === sha(f.buf), "SHA-256 differs from original"); assert(r.fileName === f.file.name, "file name");
    return `SHA-256 identical (${sha(out).slice(0, 16)}…)  decrypt ${r.metrics.decrypt_ms.toFixed(1)} ms`;
  });
}

await test("Key accepted as plain base64, base64url and hex text", async () => {
  const k = up.small.keyB64, hex = Buffer.from(k, "base64").toString("hex"), url = k.replace(/\+/g, "-").replace(/\//g, "_");
  for (const t of [k, hex, url, `  ${k}\n`]) { const r = await downloadFile({ api, fileId: up.small.manifest.file_id, keyText: t }); assert(sha(new Uint8Array(await r.blob.arrayBuffer())) === sha(small.buf)); }
});

await test("Wrong key -> authentication error, no file produced", async () => {
  const wrong = randomBytes(32).toString("base64");
  const m = await rejects(downloadFile({ api, fileId: up.big.manifest.file_id, keyText: wrong }), DecryptError, "Authentication failed for segment 0");
  return m;
});

await test("Invalid key formats are rejected with clear messages", async () => {
  await rejects(downloadFile({ api, fileId: up.small.manifest.file_id, keyText: "" }), null, "enter or upload");
  await rejects(downloadFile({ api, fileId: up.small.manifest.file_id, keyText: "abc" }), null, "256 bits");
  await rejects(downloadFile({ api, fileId: up.small.manifest.file_id, keyText: randomBytes(16).toString("base64") }), null, "256 bits");
  await rejects(downloadFile({ api, fileId: up.small.manifest.file_id, keyText: "{not json" }), null, "not valid JSON");
});

await test("Key file of a different file is rejected", async () => {
  await rejects(downloadFile({ api, fileId: up.big.manifest.file_id, keyText: JSON.stringify(up.exact.keyFile) }), null, "different file");
});

const bigDir = join(STORE, up.big.manifest.file_id);
const seg = (i) => join(bigDir, `part0000${i}.enc`);

await test("Corrupted segment (1 bit flipped in segment 1) -> detected, no file produced", async () => {
  const orig = readFileSync(seg(1)); const bad = Buffer.from(orig); bad[1000] ^= 1; writeFileSync(seg(1), bad);
  try { return await rejects(downloadFile({ api, fileId: up.big.manifest.file_id, keyText: JSON.stringify(up.big.keyFile) }), DecryptError, "segment 1"); }
  finally { writeFileSync(seg(1), orig); }
});

await test("Modified nonce bytes -> detected", async () => {
  const orig = readFileSync(seg(2)); const bad = Buffer.from(orig); bad[0] ^= 0xff; writeFileSync(seg(2), bad);
  try { return await rejects(downloadFile({ api, fileId: up.big.manifest.file_id, keyText: JSON.stringify(up.big.keyFile) }), DecryptError, "segment 2"); }
  finally { writeFileSync(seg(2), orig); }
});

await test("Truncated segment -> detected", async () => {
  const orig = readFileSync(seg(0)); writeFileSync(seg(0), orig.subarray(0, orig.length - 5));
  try { return await rejects(downloadFile({ api, fileId: up.big.manifest.file_id, keyText: JSON.stringify(up.big.keyFile) }), DecryptError, "truncated"); }
  finally { writeFileSync(seg(0), orig); }
});

await test("Swapped segments (0 <-> 1, same size) -> detected by index AAD", async () => {
  const a = readFileSync(seg(0)), b = readFileSync(seg(1)); writeFileSync(seg(0), b); writeFileSync(seg(1), a);
  try { return await rejects(downloadFile({ api, fileId: up.big.manifest.file_id, keyText: JSON.stringify(up.big.keyFile) }), DecryptError, "Authentication failed"); }
  finally { writeFileSync(seg(0), a); writeFileSync(seg(1), b); }
});

await test("Missing segment in cloud -> clear download error", async () => {
  const orig = readFileSync(seg(2)); rmSync(seg(2));
  try { return await rejects(downloadFile({ api, fileId: up.big.manifest.file_id, keyText: JSON.stringify(up.big.keyFile) }), null, "could not be downloaded"); }
  finally { writeFileSync(seg(2), orig); }
});

await test("Segment removed from manifest (tampered cloud manifest) -> caught by key-file segment count", async () => {
  const mp = join(bigDir, "manifest.json"), orig = readFileSync(mp, "utf8"), m = JSON.parse(orig);
  m.segments.pop(); m.segment_count = 2; writeFileSync(mp, JSON.stringify(m));
  try { return await rejects(downloadFile({ api, fileId: up.big.manifest.file_id, keyText: JSON.stringify(up.big.keyFile) }), null, "Segment count mismatch"); }
  finally { writeFileSync(mp, orig); }
});

await test("After all tampering tests, the untouched file still restores perfectly", async () => {
  const r = await downloadFile({ api, fileId: up.big.manifest.file_id, keyText: up.big.keyB64 });
  assert(sha(new Uint8Array(await r.blob.arrayBuffer())) === sha(big.buf), "mismatch");
});

await test("Python reference decryptor (report's algorithm) restores browser-encrypted segments", async () => {
  const tmp = join(root, "tests", ".tmp_py"); rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  for (const f of segFiles(up.big.manifest.file_id)) writeFileSync(join(tmp, f), readFileSync(join(bigDir, f)));
  writeFileSync(join(tmp, "key.json"), JSON.stringify(up.big.keyFile));
  const out = execFileSync("python3", [join(root, "scripts", "verify_segments.py"), tmp, join(tmp, "key.json"), join(tmp, "restored.bin")]).toString().trim();
  assert(sha(readFileSync(join(tmp, "restored.bin"))) === sha(big.buf), "python output differs");
  rmSync(tmp, { recursive: true, force: true }); return out;
});

await test("Dashboard/performance data is real: stats, activity and metrics come from the backend", async () => {
  const st = await api.stats(), perf = await api.performance(), act = await api.activity(50);
  assert(st.total_files === 4 && st.total_segments === 3 + 1 + 2 + 1, `files/segments: ${JSON.stringify(st)}`);
  assert(st.uploads_ok === 4 && st.downloads_ok >= 4 && st.downloads_failed >= 6, `counts: ${JSON.stringify(st)}`);
  assert(perf.records.some((r) => r.metrics.encrypt_ms > 0 && r.metrics.upload_ms > 0), "no upload metrics");
  assert(perf.records.some((r) => r.metrics.decrypt_ms > 0 && r.metrics.reconstruct_ms >= 0), "no download metrics");
  return `files=${st.total_files} segments=${st.total_segments} up_ok=${st.uploads_ok} down_ok=${st.downloads_ok} down_failed=${st.downloads_failed}`;
});

await test("Server-side verification rejects an upload whose segments were never sent", async () => {
  const init = await api.uploadInit({ filename: "ghost.bin", size: 6 * MB, content_type: "x", segment_size: 5 * MB });
  const e = await rejects(api.uploadComplete({ file_id: init.file_id, filename: "ghost.bin", size: 6 * MB, segment_size: 5 * MB }), null, "missing");
  return e;
});

await test("Delete removes all segments and manifest", async () => {
  const id = up.one.manifest.file_id; await api.deleteFile(id); assert(!existsSync(join(STORE, id)) || readdirSync(join(STORE, id)).length === 0, "files remain");
  assert((await api.files()).files.length === 3);
});

const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} end-to-end tests passed`);
process.exit(failed.length ? 1 : 0);
