// Upload (segment -> encrypt -> upload) and download (fetch -> decrypt -> verify -> merge).
// UI-independent so the same code is used by the web pages and by the automated tests.
import { OVERHEAD, generateKey, exportKeyB64, buildKeyFile, encryptSegment, decryptSegment, parseKeyInput, importKey, segmentName, DecryptError } from "./crypto.js";

const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; if (e.retryable === false) break; await sleep(400 * 2 ** i); }
  }
  throw last;
}

async function putSegment(url, bytes, headers) {
  let res;
  try { res = await fetch(url, { method: "PUT", headers, body: bytes }); }
  catch { throw new Error("Network error while uploading a segment (or the bucket CORS rules block this website)."); }
  if (!res.ok) { const e = new Error(`Cloud storage rejected the segment (HTTP ${res.status}). The signed URL may have expired.`); if (res.status === 403) e.retryable = false; throw e; }
}

/** opts: { api, file, segmentSize, onProgress(p), onSegment(info) } */
export async function uploadFile({ api, file, segmentSize, onProgress = () => {}, onSegment = () => {} }) {
  const t0 = now(), m = { segment_ms: 0, encrypt_ms: 0, upload_ms: 0 };
  const key = await generateKey();                       // 256-bit key, created in the browser
  const ctype = file.type || "application/octet-stream";
  const init = await api.uploadInit({ filename: file.name, size: file.size, content_type: ctype, segment_size: segmentSize });
  const { file_id: fileId, segment_count: count, segment_size: seg } = init;
  try {
    for (let i = 0; i < count; i++) {
      let t = now();
      const plain = await file.slice(i * seg, Math.min((i + 1) * seg, file.size)).arrayBuffer();   // real segmentation
      m.segment_ms += now() - t;
      const info = { index: i, name: segmentName(i), plainSize: plain.byteLength, encSize: plain.byteLength + OVERHEAD, status: "encrypting" };
      onSegment({ ...info }); onProgress({ phase: "encrypting", index: i, count, done: i / count });
      t = now(); const blob = await encryptSegment(key, plain, i); m.encrypt_ms += now() - t;
      info.status = "uploading"; onSegment({ ...info }); onProgress({ phase: "uploading", index: i, count, done: (i + 0.5) / count });
      t = now(); await withRetry(() => putSegment(init.uploads[i].url, blob, init.upload_headers)); m.upload_ms += now() - t;
      info.status = "uploaded"; onSegment({ ...info }); onProgress({ phase: "uploading", index: i, count, done: (i + 1) / count });
    }
    m.total_ms = now() - t0;
    const manifest = await api.uploadComplete({ file_id: fileId, filename: file.name, size: file.size, segment_size: seg, content_type: ctype, metrics: m });
    const keyB64 = await exportKeyB64(key);
    return { manifest, keyB64, keyFile: buildKeyFile(keyB64, manifest), metrics: m };
  } catch (e) {
    await api.uploadFail({ file_id: fileId, filename: file.name, size: file.size, error: e.message });
    throw e;
  }
}

/** opts: { api, fileId, keyText, onProgress(p), onSegment(info) } -> { blob, fileName, metrics } */
export async function downloadFile({ api, fileId, keyText, onProgress = () => {}, onSegment = () => {} }) {
  const t0 = now(), m = { download_ms: 0, decrypt_ms: 0, reconstruct_ms: 0 };
  let manifest;
  try {
    const { bytes, meta } = parseKeyInput(keyText);
    const key = await importKey(bytes);
    const details = await api.fileDetails(fileId);
    manifest = details.manifest;
    if (meta && meta.fileId && meta.fileId !== manifest.file_id) throw new Error("This key file belongs to a different file.");
    if (meta && meta.segmentCount && meta.segmentCount !== manifest.segment_count)
      throw new Error(`Segment count mismatch: your key file says ${meta.segmentCount}, the cloud manifest says ${manifest.segment_count}. A segment may have been added or removed.`);
    const segs = manifest.segments;
    if (segs.length !== manifest.segment_count || segs.some((s, i) => s.index !== i || s.name !== segmentName(i)))
      throw new Error("The segment list in the manifest is not sequential. Refusing to rebuild the file.");
    const parts = [];
    for (let i = 0; i < segs.length; i++) {
      const info = { index: i, name: segs[i].name, plainSize: segs[i].plain_size, encSize: segs[i].encrypted_size, status: "downloading" };
      onSegment({ ...info }); onProgress({ phase: "downloading", index: i, count: segs.length, done: i / segs.length });
      let t = now();
      const data = await withRetry(async () => {
        let res;
        try { res = await fetch(details.downloads[i].url); } catch { throw new Error("Network error while downloading a segment (or the bucket CORS rules block this website)."); }
        if (!res.ok) { const e = new Error(`Segment ${i} could not be downloaded (HTTP ${res.status}). It may be missing or the link expired.`); if (res.status === 403 || res.status === 404) e.retryable = false; throw e; }
        return new Uint8Array(await res.arrayBuffer());
      });
      m.download_ms += now() - t;
      if (data.length !== segs[i].encrypted_size) throw new DecryptError(i, `Segment ${i} has ${data.length} bytes but ${segs[i].encrypted_size} were expected: it was truncated or modified.`);
      info.status = "decrypting"; onSegment({ ...info });
      t = now(); const plain = await decryptSegment(key, data, i); m.decrypt_ms += now() - t;   // verifies tag + index
      if (plain.length !== segs[i].plain_size) throw new DecryptError(i, `Segment ${i} decrypted to an unexpected size.`);
      parts.push(plain);
      info.status = "verified"; onSegment({ ...info }); onProgress({ phase: "decrypting", index: i, count: segs.length, done: (i + 1) / segs.length });
    }
    const t = now();
    const blob = new Blob(parts, { type: manifest.file_type });                // merge in index order
    m.reconstruct_ms = now() - t;
    if (blob.size !== manifest.file_size) throw new Error("Restored size does not match the original size. File discarded.");
    m.total_ms = now() - t0;
    await api.downloadResult(fileId, { status: "success", metrics: m });
    return { blob, fileName: manifest.file_name, metrics: m };
  } catch (e) {
    if (manifest) await api.downloadResult(fileId, { status: "failed", error: e.message });
    throw e;                                                                    // no partial/invalid file is ever returned
  }
}
