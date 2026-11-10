import { api, $, esc, fmtBytes, fmtMs, renderShell, toast } from "./ui.js";
renderShell("performance", "Performance Measurement");

const STAGES = [["segment_ms", "Segmentation", "#c4b5fd"], ["encrypt_ms", "Encryption", "#8b5cf6"], ["upload_ms", "Upload", "#6d28d9"],
  ["download_ms", "Download", "#38bdf8"], ["decrypt_ms", "Decryption", "#a855f7"], ["reconstruct_ms", "Reconstruction", "#f59e0b"]];
let recs = [], segSizes = {};

async function load() {
  try { const [p, f] = await Promise.all([api.performance(), api.files()]); recs = p.records; f.files.forEach((x) => (segSizes[x.file_id] = x.segment_size)); } catch (e) { toast(e.message, "bad"); return; }
  $("#rows").innerHTML = recs.length ? recs.map((r, i) => `<tr style="cursor:pointer" data-i="${i}"><td><span class="pill ${r.kind === "upload" ? "busy" : "ok"}">${r.kind}</span></td><td class="text-break">${esc(r.file_name)}</td><td>${fmtBytes(r.file_size)}</td><td>${r.segments}</td><td>${segSizes[r.file_id] ? fmtBytes(segSizes[r.file_id]) : "-"}</td>
    ${STAGES.map(([k]) => `<td>${r.metrics[k] != null ? fmtMs(r.metrics[k]) : "-"}</td>`).join("")}<td><b>${fmtMs(r.metrics.total_ms)}</b></td></tr>`).join("")
    : '<tr><td colspan="12"><div class="empty"><i class="bi bi-hourglass"></i>No measurements yet. Upload or download a file first.</div></td></tr>';
  if (recs.length) show(0);
}
function show(i) {
  const r = recs[i], m = r.metrics, parts = STAGES.filter(([k]) => m[k] != null), sum = parts.reduce((a, [k]) => a + m[k], 0) || 1;
  const mbps = m.total_ms ? (r.file_size / 1048576) / (m.total_ms / 1000) : 0, over = r.segments * 28;
  $("#detail").hidden = false;
  $("#detail").innerHTML = `<h2>Breakdown: ${esc(r.kind)} of ${esc(r.file_name)}</h2>
    <div class="stackbar mb-2">${parts.map(([k, , c]) => `<div style="width:${(m[k] / sum * 100).toFixed(2)}%;background:${c}" title="${fmtMs(m[k])}"></div>`).join("")}</div>
    <div class="legend small mb-3">${parts.map(([k, l, c]) => `<span class="me-3"><i style="background:${c}"></i>${l}: ${fmtMs(m[k])} (${(m[k] / sum * 100).toFixed(1)}%)</span>`).join("")}</div>
    <div class="row g-2"><div class="col-6 col-md-3"><div class="metric"><div class="k">Original size</div><div class="n">${fmtBytes(r.file_size)}</div></div></div>
    <div class="col-6 col-md-3"><div class="metric"><div class="k">Segments</div><div class="n">${r.segments}</div></div></div>
    <div class="col-6 col-md-3"><div class="metric"><div class="k">Encryption overhead</div><div class="n">${over} bytes (${(over / r.file_size * 100).toFixed(4)}%)</div></div></div>
    <div class="col-6 col-md-3"><div class="metric"><div class="k">Effective throughput</div><div class="n">${mbps.toFixed(2)} MB/s</div></div></div></div>`;
}
$("#rows").onclick = (e) => { const tr = e.target.closest("[data-i]"); if (tr) show(+tr.dataset.i); };

$("#probe").onclick = async () => {
  const b = $("#probe"); b.disabled = true; const rows = [];
  for (let i = 1; i <= 5; i++) {
    const t = performance.now();
    try {
      const res = await fetch(`${location.origin}/index.html`, { cache: "no-store" }), ttfb = performance.now() - t, body = await res.arrayBuffer();
      rows.push({ i, status: res.status, x: res.headers.get("x-cache"), age: res.headers.get("age"), pop: res.headers.get("x-amz-cf-pop"), ttfb, total: performance.now() - t, bytes: body.byteLength });
    } catch (e) { rows.push({ i, err: e.message }); }
  }
  const cdn = rows.some((r) => r.x || r.pop), hits = rows.filter((r) => /hit/i.test(r.x || "")).length;
  $("#probeOut").innerHTML = (cdn ? `<div class="alert alert-info small">Served through CloudFront. In this probe <b>${hits} of ${rows.length}</b> requests were cache hits. This is only these ${rows.length} requests, not a long-term cache hit ratio.</div>`
    : '<div class="alert alert-warning small">No CloudFront headers were found, so this page is not being served through the CDN (for example you are on localhost). No cache information is available.</div>') +
    `<div class="table-wrap"><table class="table table-sm"><thead><tr><th>#</th><th>HTTP</th><th>X-Cache</th><th>Age</th><th>Edge location</th><th>Time to first byte</th><th>Total time</th><th>Size</th></tr></thead><tbody>${rows.map((r) => r.err ? `<tr><td>${r.i}</td><td colspan="7" class="text-danger">${esc(r.err)}</td></tr>` :
    `<tr><td>${r.i}</td><td>${r.status}</td><td>${esc(r.x || "not available")}</td><td>${esc(r.age ?? "-")}</td><td>${esc(r.pop || "-")}</td><td>${fmtMs(r.ttfb)}</td><td>${fmtMs(r.total)}</td><td>${fmtBytes(r.bytes)}</td></tr>`).join("")}</tbody></table></div>`;
  b.disabled = false;
};
load();
