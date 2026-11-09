import { api, $, esc, fmtBytes, fmtDate, fmtMs, renderShell, saveBlob, segPill, toast } from "./ui.js";
import { downloadFile } from "./transfer.js";
import { DecryptError } from "./crypto.js";
renderShell("download", "Secure Cloud Download");

let files = [], selected = null, busy = false;
async function loadFiles() {
  try { files = (await api.files()).files; } catch (e) { toast(e.message, "bad"); return; }
  $("#files").innerHTML = files.length ? files.map((f) => `<tr><td class="text-break">${esc(f.file_name)}</td><td>${fmtBytes(f.file_size)}</td><td>${f.segment_count}</td><td>${fmtDate(f.created_at)}</td>
    <td class="text-end text-nowrap"><button class="btn btn-sm btn-primary" data-sel="${f.file_id}"><i class="bi bi-unlock"></i> Select</button> <button class="btn btn-sm btn-outline-danger" data-del="${f.file_id}" aria-label="Delete"><i class="bi bi-trash"></i></button></td></tr>`).join("")
    : '<tr><td colspan="5"><div class="empty"><i class="bi bi-folder2-open"></i>No files uploaded yet.</div></td></tr>';
}
$("#files").onclick = async (e) => {
  const s = e.target.closest("[data-sel]"), d = e.target.closest("[data-del]");
  if (s && !busy) { selected = files.find((f) => f.file_id === s.dataset.sel); $("#dl").hidden = false; $("#sel").textContent = `${selected.file_name} (${fmtBytes(selected.file_size)}, ${selected.segment_count} segments)`; $("#out").innerHTML = ""; $("#segBox").hidden = true; $("#pg").hidden = true; $("#txt").textContent = ""; $("#dl").scrollIntoView({ behavior: "smooth" }); }
  if (d && !busy && confirm("Delete this file and all its encrypted segments from the cloud? This cannot be undone.")) {
    try { await api.deleteFile(d.dataset.del); toast("File deleted from cloud storage.", "ok"); if (selected && selected.file_id === d.dataset.del) { selected = null; $("#dl").hidden = true; } loadFiles(); } catch (err) { toast(err.message, "bad"); }
  }
};
$("#reload").onclick = loadFiles;
$("#keyFile").onchange = async (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 10000) return toast("That does not look like a key file (too large).", "warn"); $("#keyText").value = await f.text(); };

$("#go").onclick = async () => {
  if (!selected || busy) return;
  busy = true; $("#go").disabled = true; $("#out").innerHTML = ""; $("#pg").hidden = false; $("#segBox").hidden = false; $("#segs").innerHTML = "";
  const rows = new Map();
  try {
    const r = await downloadFile({ api, fileId: selected.file_id, keyText: $("#keyText").value,
      onProgress: (p) => { $("#bar").style.width = (p.done * 100).toFixed(1) + "%"; $("#txt").textContent = `Segment ${p.index + 1} of ${p.count}`; },
      onSegment: (s) => { let tr = rows.get(s.index); if (!tr) { tr = document.createElement("tr"); rows.set(s.index, tr); $("#segs").append(tr); }
        tr.innerHTML = `<td>${s.index}</td><td class="mono">${s.name}</td><td>${fmtBytes(s.encSize)}</td><td>${fmtBytes(s.plainSize)}</td><td>${segPill(s.status)}</td>`; } });
    $("#bar").style.width = "100%"; $("#txt").textContent = "";
    const m = r.metrics, met = (k, v) => `<div class="col-6 col-md-3"><div class="metric"><div class="k">${k}</div><div class="n">${v}</div></div></div>`;
    $("#out").innerHTML = `<div class="alert alert-success"><i class="bi bi-patch-check-fill"></i> All ${selected.segment_count} segments authenticated and merged. The original file is restored (${fmtBytes(r.blob.size)}).
      <div class="mt-2"><button class="btn btn-success btn-sm" id="again"><i class="bi bi-download"></i> Save ${esc(r.fileName)}</button></div></div>
      <div class="row g-2">${met("Download", fmtMs(m.download_ms))}${met("Decryption", fmtMs(m.decrypt_ms))}${met("Reconstruction", fmtMs(m.reconstruct_ms))}${met("Total", fmtMs(m.total_ms))}</div>`;
    $("#again").onclick = () => saveBlob(r.blob, r.fileName); saveBlob(r.blob, r.fileName); toast("File restored and downloaded.", "ok");
  } catch (e) {
    const auth = e instanceof DecryptError;
    $("#out").innerHTML = `<div class="alert alert-danger mb-0"><i class="bi bi-x-octagon-fill"></i> <b>${auth ? "Decryption failed." : "Could not restore the file."}</b> ${esc(e.message)}<div class="small mt-1">No restored file was created.</div></div>`;
    $("#bar").style.width = "0%"; $("#txt").textContent = ""; toast(auth ? "Wrong key or modified data. File not restored." : e.message, "bad", 8000);
    const bad = rows.get(e.index); if (bad) bad.lastElementChild.innerHTML = segPill("failed");
  }
  busy = false; $("#go").disabled = false;
};
loadFiles();
