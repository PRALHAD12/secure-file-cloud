// AES-256-GCM helpers (Web Crypto API). Runs in the browser; the key never leaves it.
// Segment layout:  nonce (12 bytes) || ciphertext || GCM tag (16 bytes)
// AAD (authenticated additional data) = segment index as decimal ASCII text, e.g. "0", "1", "2" ...
export const NONCE_BYTES = 12, TAG_BYTES = 16, KEY_BYTES = 32, OVERHEAD = NONCE_BYTES + TAG_BYTES;
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

export class DecryptError extends Error {
  constructor(index, message) { super(message); this.name = "DecryptError"; this.index = index; }
}
export class KeyFormatError extends Error { constructor(m) { super(m); this.name = "KeyFormatError"; } }

export const segmentName = (i) => `part${String(i).padStart(5, "0")}.enc`;
const aad = (i) => enc.encode(String(i));

export const b64 = (u8) => { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
export const fromB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** Generate a fresh random 256-bit key. */
export const generateKey = () => subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
export async function exportKeyB64(key) { return b64(new Uint8Array(await subtle.exportKey("raw", key))); }

/** Accepts a base64 / base64url / 64-char hex key, or the JSON text of a saved key file. */
export function parseKeyInput(text) {
  text = String(text || "").trim();
  if (!text) throw new KeyFormatError("Please enter or upload your encryption key.");
  let meta = null, raw = text;
  if (text.startsWith("{")) {
    try { meta = JSON.parse(text); } catch { throw new KeyFormatError("The key file is not valid JSON."); }
    if (meta.type !== "secure-file-cloud-key" || typeof meta.key !== "string") throw new KeyFormatError("This is not a Secure File Cloud key file.");
    raw = meta.key;
  }
  raw = raw.replace(/\s+/g, "");
  let bytes;
  try { bytes = /^[0-9a-fA-F]{64}$/.test(raw) ? Uint8Array.from(raw.match(/../g), (h) => parseInt(h, 16)) : fromB64(raw); }
  catch { throw new KeyFormatError("The key is not valid base64 or hex text."); }
  if (bytes.length !== KEY_BYTES) throw new KeyFormatError(`The key must be 256 bits (32 bytes); this one is ${bytes.length * 8} bits.`);
  return { bytes, meta };
}
export const importKey = (bytes) => subtle.importKey("raw", bytes, "AES-GCM", false, ["decrypt"]);

/** Content of the downloadable key file. It also records the file id and segment count so a later
 *  download can detect a missing/extra segment, even if someone edits the cloud manifest. */
export function buildKeyFile(keyB64, m) {
  return { type: "secure-file-cloud-key", version: 1, algorithm: "AES-256-GCM", key: keyB64, fileId: m.file_id,
           fileName: m.file_name, fileSize: m.file_size, segmentCount: m.segment_count, segmentSize: m.segment_size,
           warning: "Keep this file secret. Anyone with it can decrypt the file. If you lose it, the data is unrecoverable." };
}

export async function encryptSegment(key, plain, index) {
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES)); // fresh random nonce per segment
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(index), tagLength: 128 }, key, plain));
  const out = new Uint8Array(NONCE_BYTES + ct.length);
  out.set(nonce, 0); out.set(ct, NONCE_BYTES);
  return out;
}

export async function decryptSegment(key, data, index) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (u8.length < OVERHEAD) throw new DecryptError(index, `Segment ${index} is too short to be valid (truncated or corrupted).`);
  try {
    return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: u8.subarray(0, NONCE_BYTES), additionalData: aad(index), tagLength: 128 }, key, u8.subarray(NONCE_BYTES)));
  } catch {
    throw new DecryptError(index, `Authentication failed for segment ${index}: the key is wrong, or the segment was modified, damaged or placed in the wrong order.`);
  }
}
