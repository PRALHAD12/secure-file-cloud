// Thin client for the Flask API. base = "" means "same origin" (local run); otherwise the backend URL.
export class ApiError extends Error { constructor(m, status) { super(m); this.name = "ApiError"; this.status = status; } }

export function createApi(base = "") {
  base = base.replace(/\/$/, "");
  async function req(method, path, body) {
    let res;
    try {
      res = await fetch(base + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    } catch { throw new ApiError("Cannot reach the backend server. Is it running, and is the API address correct?", 0); }
    let data = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) throw new ApiError(data.error || `Server error (${res.status})`, res.status);
    return data;
  }
  return {
    health: () => req("GET", "/api/health"),
    stats: () => req("GET", "/api/stats"),
    activity: (n = 10) => req("GET", `/api/activity?limit=${n}`),
    performance: () => req("GET", "/api/performance"),
    files: () => req("GET", "/api/files"),
    fileDetails: (id) => req("GET", `/api/files/${id}`),
    deleteFile: (id) => req("DELETE", `/api/files/${id}`),
    uploadInit: (b) => req("POST", "/api/upload/init", b),
    uploadComplete: (b) => req("POST", "/api/upload/complete", b),
    uploadFail: (b) => req("POST", "/api/upload/fail", b).catch(() => {}),
    downloadResult: (id, b) => req("POST", `/api/files/${id}/download-result`, b).catch(() => {}),
  };
}
