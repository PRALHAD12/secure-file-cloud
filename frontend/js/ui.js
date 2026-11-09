// Shared UI helpers: sidebar/topbar shell, toasts, formatting, file saving.
import { createApi } from "./api.js";
export const api = createApi((window.SFS_CONFIG && window.SFS_CONFIG.API_BASE) || "");
export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function fmtBytes(n) { if (n == null) return "-"; const u = ["B", "KB", "MB", "GB"]; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return `${n.toFixed(i ? 2 : 0)} ${u[i]}`; }
export const fmtMs = (ms) => (ms == null ? "-" : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(1)} ms`);
export const fmtDate = (s) => (s ? new Date(s).toLocaleString() : "-");

const NAV = [["dashboard", "Dashboard", "bi-speedometer2"], ["upload", "Secure Upload", "bi-cloud-arrow-up"], ["download", "Secure Download", "bi-cloud-arrow-down"],
  ["performance", "Performance", "bi-graph-up-arrow"], ["about", "About & Hosting", "bi-info-circle"]];

export function renderShell(active, title) {
  $("#sidebar").className = "sidebar";
  $("#sidebar").innerHTML = `<a class="brand" href="index.html"><span class="logo"><i class="bi bi-shield-lock-fill"></i></span><span>Secure File Cloud<small>Segment · Encrypt · Deliver</small></span></a>
    ${NAV.map(([id, label, ic]) => `<a class="side-link ${id === active ? "active" : ""}" href="${id}.html"><i class="bi ${ic}"></i>${label}</a>`).join("")}
    <a class="side-link" href="index.html"><i class="bi bi-house"></i>Home</a>
    <div class="side-foot"><i class="bi bi-lock"></i> AES-256-GCM · Amazon S3 · CloudFront</div>`;
  $("#topbar").className = "topbar";
  $("#topbar").innerHTML = `<button class="menu-btn" aria-label="Menu"><i class="bi bi-list"></i></button><h1>${esc(title)}</h1><span class="ms-auto pill" id="cloud-pill"><span class="dot"></span>Checking…</span>`;
  document.body.insertAdjacentHTML("beforeend", '<div class="scrim" id="scrim"></div><div class="toasts" id="toasts"></div>');
  const toggle = () => { $("#sidebar").classList.toggle("open"); $("#scrim").classList.toggle("show"); };
  $(".menu-btn").onclick = toggle; $("#scrim").onclick = toggle;
  refreshCloudPill();
}

export async function refreshCloudPill() {
  const p = $("#cloud-pill"); if (!p) return null;
  try {
    const h = await api.health();
    p.className = "ms-auto pill " + (!h.cloud_ok ? "bad" : h.storage_mode === "s3" ? "ok" : "warn");
    p.innerHTML = `<span class="dot"></span>${!h.cloud_ok ? "Cloud unreachable" : h.storage_mode === "s3" ? "AWS S3 connected" : "Local dev storage"}`;
    p.title = h.detail; return h;
  } catch { p.className = "ms-auto pill bad"; p.innerHTML = '<span class="dot"></span>Backend offline'; return null; }
}

export function toast(msg, type = "info", ms = 5000) {
  const ic = { ok: "bi-check-circle-fill text-success", bad: "bi-x-octagon-fill text-danger", warn: "bi-exclamation-triangle-fill text-warning", info: "bi-info-circle-fill text-primary" }[type];
  const t = document.createElement("div"); t.className = `toast-x ${type}`; t.setAttribute("role", "alert");
  t.innerHTML = `<i class="bi ${ic}"></i><div>${esc(msg)}</div>`; $("#toasts").append(t); setTimeout(() => t.remove(), ms);
}

export function saveBlob(blob, name) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

export const statusPill = (s) => `<span class="pill ${s === "success" ? "ok" : "bad"}"><span class="dot"></span>${s === "success" ? "Success" : "Failed"}</span>`;
export const segPill = (s) => { const m = { encrypting: ["busy", "Encrypting"], uploading: ["busy", "Uploading"], uploaded: ["ok", "Uploaded"], downloading: ["busy", "Downloading"], decrypting: ["busy", "Verifying"], verified: ["ok", "Verified"], failed: ["bad", "Failed"] }[s] || ["", s]; return `<span class="pill ${m[0]}"><span class="dot"></span>${m[1]}</span>`; };
export const shell = (inner) => `<div id="sidebar"></div><main class="content"><header id="topbar"></header><div class="page">${inner}</div></main>`;
