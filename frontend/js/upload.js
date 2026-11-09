import { api, $, esc, fmtBytes, fmtMs, renderShell, saveBlob, segPill, toast } from "./ui.js";
import { uploadFile } from "./transfer.js";
renderShell("upload", "Secure File Upload");

const MB = 1024 * 1024;
let limits = null, queue = [], busy = false, unsavedKeys = 0;
api.health().then((h) => { limits = h; $("#limit").textContent = `Multiple files allowed · max ${fmtBytes(h.max_file_size)} per file`; }).catch(() => toast("Backend is offline. Start it with: python -m backend.app", "bad", 9000));

function check(f) {
  if (f.size === 0) return "Empty file";
  if (f.name.length > 255) return "Name too long";
  if (limits && f.size > limits.max_file_size) return `Over ${fmtBytes(limits.max_file_size)} limit`;
  if (queue.some((q) => q.file.name === f.name && q.file.size === f.size && q.file.lastModified === f.lastModified)) return "Already added";
  return "";
}
function addFiles(list) {
  for (const f of list) { const err = check(f); if (err === "Already added") continue; queue.push({ file: f, err, state: "ready" }); if (err) toast(`${f.name}: ${err}`, "warn"); }
  renderQueue();
}
function renderQueue() {
  $("#queueTable").hidden = !queue.length;
  $("#queue").innerHTML = queue.map((q, i) => `<tr><td class="text-break">${esc(q.file.name)}</td><td>${fmtBytes(q.file.size)}</td><td>${esc(q.file.type || "unknown")}</td>
    <td>${q.err ? `<span class="pill bad"><span class="dot"></span>${esc(q.err)}</span>` : q.state === "done" ? '<span class="pill ok"><span class="dot"></span>Uploaded</span>' : '<span class="pill ok"><span class="dot"></span>Valid</span>'}</td>
    <td><button class="btn btn-sm btn-outline-secondary" data-rm="${i}" ${busy ? "disabled" : ""} aria-label="Remove"><i class="bi bi-x"></i></button></td></tr>`).join("");
  $("#startBtn").disabled = busy || !queue.some((q) => !q.err && q.state === "ready");
}
$("#queue").onclick = (e) => { const b = e.target.closest("[data-rm]"); if (b && !busy) { queue.splice(+b.dataset.rm, 1); renderQueue(); } };
const drop = $("#drop"), input = $("#fileInput");
drop.onclick = () => input.click(); drop.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") input.click(); };
input.onchange = () => { addFiles(input.files); input.value = ""; };
["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
window.addEventListener("beforeunload", (e) => { if (busy || unsavedKeys > 0) { e.preventDefault(); e.returnValue = ""; } });

function makeJob(file) {
  const el = document.createElement("div"); el.className = "panel mb-3";
  el.innerHTML = `<div class="d-flex justify-content-between flex-wrap gap-2 mb-2"><div><b class="text-break">${esc(file.name)}</b> <span class="text-secondary small">${fmtBytes(file.size)}</span></div><span class="pill busy" data-s="phase"><span class="dot"></span>Starting…</span></div>
    <div class="progress mb-2"><div class="progress-bar" data-s="bar" style="width:0%"></div></div>
    <div class="small text-secondary mb-2" data-s="text"></div><div data-s="result"></div>
    <details class="mt-2" open><summary class="small fw-semibold">Segments (<span data-s="count">0</span>)</summary><div class="table-wrap mt-2"><table class="table table-sm"><thead><tr><th>Index</th><th>Object name</th><th>Plain size</th><th>Encrypted size</th><th>Status</th></tr></thead><tbody data-s="segs"></tbody></table></div></details>`;
  $("#jobs").prepend(el); return (s) => $(`[data-s="${s}"]`, el);
}

$("#startBtn").onclick = async () => {
  busy = true; renderQueue();
  const segSize = +$("#segSize").value * MB;
  for (const q of queue.filter((x) => !x.err && x.state === "ready")) {
    const g = makeJob(q.file), rows = new Map();
    try {
      const r = await uploadFile({ api, file: q.file, segmentSize: segSize,
        onProgress: (p) => { g("bar").style.width = (p.done * 100).toFixed(1) + "%"; g("text").textContent = `${p.phase === "encrypting" ? "Segmenting & encrypting" : "Uploading"} segment ${p.index + 1} of ${p.count}`; g("phase").innerHTML = `<span class="dot"></span>${p.phase === "encrypting" ? "Encrypting" : "Uploading"}`; },
        onSegment: (s) => { let tr = rows.get(s.index); if (!tr) { tr = document.createElement("tr"); rows.set(s.index, tr); g("segs").append(tr); g("count").textContent = rows.size; }
          tr.innerHTML = `<td>${s.index}</td><td class="mono">${s.name}</td><td>${fmtBytes(s.plainSize)}</td><td>${fmtBytes(s.encSize)}</td><td>${segPill(s.status)}</td>`; } });
      q.state = "done"; g("bar").style.width = "100%"; g("phase").className = "pill ok"; g("phase").innerHTML = '<span class="dot"></span>Complete'; g("text").textContent = "";
      const m = r.manifest, mt = r.metrics, kf = r.keyFile; let saved = false; unsavedKeys++;
      const keyName = `${m.file_name}.${m.file_id.slice(0, 8)}.sfskey`;
      const saveKey = () => { saveBlob(new Blob([JSON.stringify(kf, null, 2)], { type: "application/json" }), keyName); if (!saved) { saved = true; unsavedKeys--; } };
      const met = (k, v) => `<div class="col-6 col-md-3"><div class="metric"><div class="k">${k}</div><div class="n">${v}</div></div></div>`;
      g("result").innerHTML = `<div class="alert alert-warning small"><i class="bi bi-exclamation-triangle-fill"></i> <b>Save your encryption key now.</b> It exists only in this browser tab. Without it the file cannot be recovered by anyone, including you.</div>
        <div class="keybox mono mb-2"><span data-k>••••••••••••••••••••••••••••••••••••••••••••</span></div>
        <div class="d-flex flex-wrap gap-2 mb-3"><button class="btn btn-primary btn-sm" data-act="save"><i class="bi bi-download"></i> Save key file</button><button class="btn btn-outline-secondary btn-sm" data-act="show"><i class="bi bi-eye"></i> Show key</button><button class="btn btn-outline-secondary btn-sm" data-act="copy"><i class="bi bi-clipboard"></i> Copy key</button></div>
        <div class="row g-2">${met("Original size", fmtBytes(m.file_size))}${met("Segments", `${m.segment_count} × ${fmtBytes(m.segment_size)}`)}${met("Encrypted total", fmtBytes(m.total_encrypted_size))}${met("Overhead", `${m.segment_count * 28} bytes`)}
        ${met("Segmentation", fmtMs(mt.segment_ms))}${met("Encryption", fmtMs(mt.encrypt_ms))}${met("Upload", fmtMs(mt.upload_ms))}${met("Total", fmtMs(mt.total_ms))}</div>`;
      g("result").onclick = async (e) => { const b = e.target.closest("[data-act]"); if (!b) return;
        if (b.dataset.act === "save") saveKey();
        if (b.dataset.act === "show") { const k = $("[data-k]", g("result")); const shown = b.dataset.on === "1"; k.textContent = shown ? "••••••••••••••••••••••••••••••••••••••••••••" : r.keyB64; b.dataset.on = shown ? "0" : "1"; b.innerHTML = shown ? '<i class="bi bi-eye"></i> Show key' : '<i class="bi bi-eye-slash"></i> Hide key'; }
        if (b.dataset.act === "copy") { try { await navigator.clipboard.writeText(r.keyB64); toast("Key copied. Paste it somewhere safe.", "ok"); } catch { toast("Copy failed. Use Save key file instead.", "warn"); } } };
      saveKey();                                  // also save automatically so the key is not forgotten
      toast(`${q.file.name} uploaded in ${m.segment_count} encrypted segment(s). Key file downloaded.`, "ok");
    } catch (e) {
      q.err = "Upload failed"; g("phase").className = "pill bad"; g("phase").innerHTML = '<span class="dot"></span>Failed';
      g("result").innerHTML = `<div class="alert alert-danger small mb-0"><i class="bi bi-x-octagon-fill"></i> ${esc(e.message)} Incomplete segments were removed from the cloud.</div>`; toast(`${q.file.name}: ${e.message}`, "bad", 9000);
    }
    renderQueue();
  }
  busy = false; renderQueue();
};
