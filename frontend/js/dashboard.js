import { api, $, esc, fmtBytes, fmtDate, renderShell, statusPill, toast } from "./ui.js";
renderShell("dashboard", "Dashboard");

const card = (icon, cls, v, l) => `<div class="col-sm-6 col-xl-4"><div class="panel stat"><div class="ico ${cls}"><i class="bi ${icon}"></i></div><div><div class="v">${v}</div><div class="l">${l}</div></div></div></div>`;
const row = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
const empty = (cols, icon, text) => `<tr><td colspan="${cols}"><div class="empty"><i class="bi ${icon}"></i>${text}</div></td></tr>`;

async function load() {
  try {
    const [h, s, a, f] = await Promise.all([api.health(), api.stats(), api.activity(8), api.files()]);
    $("#cards").innerHTML = card("bi-files", "", s.total_files, "Total uploaded files") + card("bi-layers", "n", s.total_segments, "Total file segments") +
      card("bi-hdd", "", fmtBytes(s.storage_bytes), "Cloud storage used (encrypted)") + card("bi-cloud-check", "g", s.uploads_ok, "Successful uploads") +
      card("bi-cloud-download", "g", s.downloads_ok, "Successful downloads") + card("bi-exclamation-octagon", "r", s.uploads_failed + s.downloads_failed, "Failed operations");
    $("#activity").innerHTML = a.activity.length ? a.activity.map((x) => row([fmtDate(x.ts), esc(x.kind), esc(x.file_name || "-"), fmtBytes(x.file_size), statusPill(x.status)])).join("")
      : empty(5, "bi-inbox", "No activity yet. Upload your first file.");
    $("#files").innerHTML = f.files.length ? f.files.map((x) => row([esc(x.file_name), fmtBytes(x.file_size), x.segment_count, fmtBytes(x.total_encrypted_size), fmtDate(x.created_at)])).join("")
      : empty(5, "bi-folder2-open", "No files stored yet.");
    const kv = (k, v) => `<div class="d-flex justify-content-between py-2 border-bottom"><span class="text-secondary">${k}</span><span class="text-end">${v}</span></div>`;
    $("#cloud").innerHTML = `<h2>Cloud connection</h2><div class="mb-3"><span class="pill ${!h.cloud_ok ? "bad" : h.storage_mode === "s3" ? "ok" : "warn"}"><span class="dot"></span>${!h.cloud_ok ? "Not connected" : h.storage_mode === "s3" ? "Connected to AWS S3" : "Local development mode"}</span></div>
      <p class="small text-secondary">${esc(h.detail)}</p>${kv("Storage", h.storage_mode === "s3" ? "Amazon S3" : "Local folder (not AWS)")}${kv("Bucket", esc(h.bucket || "-"))}${kv("Region", esc(h.region))}
      ${kv("CloudFront", esc(h.cloudfront_domain || "not configured"))}${kv("Segment size", fmtBytes(h.segment_size))}${kv("Signed URL lifetime", h.presign_expiry + " s")}${kv("Max file size", fmtBytes(h.max_file_size))}
      ${kv("Original data", fmtBytes(s.original_bytes))}`;
  } catch (e) { toast(e.message, "bad"); }
}
$("#refresh").onclick = load; load(); setInterval(load, 20000);
