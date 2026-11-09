// Demo script to upload a test file via the running server API
import { randomBytes, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createApi } from "../frontend/js/api.js";
import { uploadFile } from "../frontend/js/transfer.js";

const api = createApi("http://127.0.0.1:5000");

// Create sample 6 MB content so it splits into 2 segments (5 MB + 1 MB)
const size = 6 * 1024 * 1024;
const buffer = Buffer.alloc(size);
buffer.write("--- SECURE FILE CLOUD DEMO DOCUMENT ---\n\n", "utf-8");
for (let i = 40; i < size; i += 64) {
  buffer.write("Confidential project data line " + (i / 64) + "\n", i, "utf-8");
}

const file = Object.assign(new Blob([buffer], { type: "text/plain" }), {
  name: "demo_secure_report.txt"
});

console.log("Starting upload of:", file.name, `(${file.size} bytes)...`);

const result = await uploadFile({
  api,
  file,
  segmentSize: 5 * 1024 * 1024,
  onSegment: (s) => console.log(`Segment ${s.index + 1}/${s.total}: ${s.name} (${s.status})`)
});

const keyFileName = "demo_secure_report.txt.sfskey";
writeFileSync(keyFileName, JSON.stringify(result.keyFile, null, 2));

console.log("\nUpload complete!");
console.log("- File ID:", result.manifest.file_id);
console.log("- Segments:", result.manifest.segment_count);
console.log("- Key file saved to:", keyFileName);
console.log("- Raw Key (Base64):", result.keyB64);

