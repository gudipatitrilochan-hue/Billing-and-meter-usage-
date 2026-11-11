// One door to the backend. Pages call api("/usage", {query:{period}}) and never care
// whether the mock or the real FastAPI server answered.

import { CONFIG } from "./config.js";
import { getSession } from "./auth-store.js";

export class ApiError extends Error {
  constructor(status, error, detail) {
    super(detail || error);
    this.status = status;
    this.error = error;
    this.detail = detail || error;
  }
}

let mockModule = null;
async function mock() {
  if (!mockModule) mockModule = await import("./mock/server.js");
  return mockModule;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function authHeaders(override) {
  const s = override || getSession();
  if (!s) return {};
  if (s.kind === "admin") return { "X-Admin-Key": s.key };
  if (s.kind === "both") return { "X-Admin-Key": s.key, "X-Api-Key": s.key };
  return { "X-Api-Key": s.key };
}

/**
 * @param {string} path  e.g. "/invoices/12/finalize"
 * @param {{method?:string, body?:any, query?:Record<string,any>, session?:object, text?:boolean, latency?:boolean}} opts
 */
export async function api(path, opts = {}) {
  const method = (opts.method || "GET").toUpperCase();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query || {})) if (v !== undefined && v !== null && v !== "") qs.set(k, v);
  const headers = authHeaders(opts.session);

  if (CONFIG.API_MODE === "mock") {
    const m = await mock();
    if (opts.latency !== false) {
      const [lo, hi] = CONFIG.MOCK_LATENCY;
      await sleep(lo + Math.random() * (hi - lo));
    }
    const res = await m.handle(method, path, { headers, body: opts.body ? JSON.parse(JSON.stringify(opts.body)) : undefined, query: qs.toString() });
    if (res.status >= 400) throw new ApiError(res.status, res.body.error, res.body.detail);
    return res.body;
  }

  let res;
  try {
    res = await fetch(CONFIG.API_BASE + path + (qs.toString() ? "?" + qs : ""), {
      method,
      headers: { ...headers, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new ApiError(0, "unreachable", "Can't reach the billing server");
  }
  const type = res.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const err = typeof payload === "object" ? payload : {};
    // FastAPI's default validation shape is {detail:[...]}; normalise it.
    const detail = Array.isArray(err.detail) ? err.detail.map((d) => d.msg).join("; ") : err.detail;
    throw new ApiError(res.status, err.error || "http_" + res.status, detail || res.statusText);
  }
  return payload;
}

/**
 * Upload a PDF (₹20 each). Live mode sends multipart/form-data to POST /api/pdfs; mock mode keeps
 * the file in the browser as a blob: URL and records the same usage event.
 * @param {File} file
 * @param {string} idempotencyKey  same key on a retry = same link, charged once
 */
export async function uploadPdf(file, idempotencyKey) {
  if (CONFIG.API_MODE === "mock") {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    const isPdf = String.fromCharCode(...head) === "%PDF-";
    const link = isPdf && file.size && file.size <= 10 * 1024 * 1024 ? URL.createObjectURL(file) : null;
    return api("/pdfs", { method: "POST", body: { filename: file.name, size_bytes: file.size, is_pdf: isPdf, link, idempotency_key: idempotencyKey } });
  }
  const form = new FormData();
  form.append("file", file, file.name);
  let res;
  try {
    res = await fetch(CONFIG.API_BASE + "/pdfs", { method: "POST", headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey }, body: form });
  } catch (e) {
    throw new ApiError(0, "unreachable", "Can't reach the billing server");
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, payload.error || "http_" + res.status, payload.detail || res.statusText);
  return payload;
}

export async function resetDemoData() {
  if (CONFIG.API_MODE !== "mock") return;
  const m = await mock();
  await m.resetMock();
}

export async function getDemoKeys() {
  if (CONFIG.API_MODE !== "mock") return null;
  const m = await mock();
  return m.demoKeys();
}
