// In-browser implementation of the PRD Section 9 API contract, used during the frontend phase.
// It enforces the same rules the FastAPI backend will: tenant from key, idempotency on
// (tenant_id, event_id), validation codes, closed periods, invoice state machine, 404 isolation.
// Responses are {status, body} with errors shaped {error, detail}.

import { CONFIG } from "../config.js";
import { buildInvoice, validateTiers, tierLabel } from "../pricing.js";
import { buildSeed, periodOf, periodStart, daysIn, sha256, tokenUrlSafe } from "./seed.js";

const STORE_KEY = "ml_mock_db_v1";
const EVENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const METER_IDS = ["api_calls", "emails_sent"];

let db = null;
let index = null; // Map "tenant|event_id" -> row
let loading = null;
let storageWarned = false;

// ---------------- persistence ----------------

async function load() {
  if (db) return db;
  if (loading) return loading;
  loading = (async () => {
    let raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) {}
    if (raw) {
      try { db = JSON.parse(raw); } catch (e) { db = null; }
    }
    if (!db || db.version !== 2) {
      db = await buildSeed();
      persist();
    }
    rebuildIndex();
    return db;
  })();
  return loading;
}

function rebuildIndex() {
  index = new Map();
  for (const e of db.events) index.set(e[0] + "|" + e[1], e);
}

let persistTimer = null;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(db));
    } catch (e) {
      if (!storageWarned) {
        storageWarned = true;
        window.dispatchEvent(new CustomEvent("ml:mock-storage-full"));
      }
    }
  }, 60);
}

export async function resetMock() {
  try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  db = null; loading = null;
  await load();
  persistNow();
}
function persistNow() {
  clearTimeout(persistTimer);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) {}
}

export async function demoKeys() {
  await load();
  return { admin: CONFIG.MOCK_ADMIN_KEY, tenants: db.tenants.map((t) => ({ id: t.id, name: t.name, key: db.demoKeys[t.id] })).filter((t) => t.key) };
}

// ---------------- helpers ----------------

class HttpError extends Error {
  constructor(status, error, detail) { super(detail); this.status = status; this.error = error; this.detail = detail; }
}
const fail = (status, error, detail) => { throw new HttpError(status, error, detail); };
const nowIso = () => new Date().toISOString();

function planById(id) { return db.plans.find((p) => p.id === id); }
function tenantById(id) { return db.tenants.find((t) => t.id === id); }

function planOut(p) {
  const locked = db.invoices.some((i) => i.plan_id === p.id && i.status !== "draft");
  return { id: p.id, name: p.name, base_fee_paise: p.base_fee_paise, currency: p.currency, active: !!p.active, created_at: p.created_at, locked, tiers: p.tiers };
}

function tenantOut(t) {
  return {
    id: t.id, name: t.name, plan_id: t.plan_id, status: t.status, created_at: t.created_at,
    key_prefix: t.key_prefix, key_masked: `${t.key_prefix.slice(0, 7)}…${t.key_last4}`,
  };
}

function usageFor(tenantId, period) {
  const out = { api_calls: 0, emails_sent: 0, pdf_links: 0 };
  for (const e of db.events) if (e[0] === tenantId && periodOf(e[4]) === period) out[e[2]] += e[3];
  return out;
}

function usageAll(period) {
  const out = {};
  for (const t of db.tenants) out[t.id] = { api_calls: 0, emails_sent: 0, pdf_links: 0 };
  for (const e of db.events) if (periodOf(e[4]) === period && out[e[0]]) out[e[0]][e[2]] += e[3];
  return out;
}

function estimate(tenant, period, usage = usageFor(tenant.id, period)) {
  const plan = planById(tenant.plan_id);
  const inv = buildInvoice(plan, usage);
  return {
    tenant_id: tenant.id, period, plan_id: plan.id, plan_name: plan.name, usage,
    base_fee_paise: inv.base_fee, total_paise: inv.total, saved: false,
    lines: inv.lines.map((l) => ({ meter_id: l.meter, tier_label: l.tier, units: l.units, price_per_1000_paise: l.per_1000, amount_paise: l.amount })),
  };
}

function isClosed(tenantId, period) {
  return db.invoices.some((i) => i.tenant_id === tenantId && i.period === period && (i.status === "finalized" || i.status === "paid"));
}

function checkPeriod(q, required = true) {
  const p = q.get("period");
  if (!p) { if (required) fail(400, "bad_period", "period is required, format YYYY-MM"); return periodOf(Date.now()); }
  if (!PERIOD_RE.test(p)) fail(400, "bad_period", "period must look like 2026-09");
  return p;
}

function invoiceOut(inv, withLines = true) {
  const t = tenantById(inv.tenant_id);
  const o = { ...inv, tenant_name: t ? t.name : inv.tenant_id };
  if (!withLines) delete o.lines;
  else o.lines = inv.lines.map((l) => ({ ...l }));
  return o;
}

// ---------------- auth ----------------

async function resolveAuth(headers) {
  const adminKey = headers["X-Admin-Key"];
  const apiKey = headers["X-Api-Key"];
  if (adminKey) {
    if (adminKey === CONFIG.MOCK_ADMIN_KEY) return { role: "admin" };
    if (!apiKey) fail(401, "bad_key", "Key not recognised");
  }
  if (apiKey) {
    const h = await sha256(apiKey);
    const t = db.tenants.find((x) => x.api_key_hash === h);
    if (!t) fail(401, "bad_key", "Key not recognised");
    if (t.status === "suspended") fail(403, "tenant_suspended", "This tenant is suspended");
    return { role: "tenant", tenant: t };
  }
  return { role: null };
}

const requireAny = (a) => { if (!a.role) fail(401, "missing_key", "Send X-Api-Key or X-Admin-Key"); };
const requireAdmin = (a) => { requireAny(a); if (a.role !== "admin") fail(403, "admin_only", "This route needs the admin key"); };

/** Tenant for a tenant-scoped route: from the key, or ?tenant_id= for admin. */
function scopeTenant(a, q, { optional = false } = {}) {
  requireAny(a);
  if (a.role === "tenant") return a.tenant;
  const id = q.get("tenant_id");
  if (!id) { if (optional) return null; fail(400, "tenant_required", "Admin must pass ?tenant_id="); }
  const t = tenantById(id);
  if (!t) fail(404, "not_found", "Tenant not found");
  return t;
}

// ---------------- ingestion ----------------

function validateEvent(ev, tenant) {
  if (!ev || typeof ev !== "object") return [400, "invalid_event", "Event must be a JSON object"];
  const { event_id, meter, quantity, timestamp } = ev;
  if (typeof event_id !== "string" || !EVENT_ID_RE.test(event_id))
    return [400, "invalid_event_id", "event_id must be 1 to 64 letters, digits, - or _"];
  if (!METER_IDS.includes(meter)) return [400, "unknown_meter", `meter must be one of ${METER_IDS.join(", ")}`];
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000000)
    return [400, "invalid_quantity", "quantity must be an integer from 1 to 1,000,000"];
  const ms = typeof timestamp === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(timestamp) ? Date.parse(timestamp) : NaN;
  if (Number.isNaN(ms)) return [400, "bad_timestamp", "timestamp must be ISO 8601, e.g. 2026-09-14T10:21:05Z"];
  if (ms > Date.now() + 5 * 60000) return [400, "bad_timestamp", "timestamp is more than 5 minutes in the future"];
  const period = periodOf(ms);
  return { ms, period };
}

/** Returns {code, status, body} for one event; inserts if new. */
function ingestOne(ev, tenant) {
  const v = validateEvent(ev, tenant);
  if (Array.isArray(v)) return { code: v[0], body: { error: v[1], detail: v[2] } };
  const key = tenant.id + "|" + ev.event_id;
  const existing = index.get(key);
  // "INSERT ... ON CONFLICT DO NOTHING" then compare with the stored row.
  if (existing) {
    const same = existing[2] === ev.meter && existing[3] === ev.quantity && existing[4] === v.ms;
    if (same) return { code: 200, body: { status: "duplicate", event_id: ev.event_id } };
    return { code: 409, body: { error: "event_id_reused", detail: "event_id was already used with different data" } };
  }
  if (isClosed(tenant.id, v.period))
    return { code: 409, body: { error: "period_closed", detail: `The ${v.period} invoice is finalized; new events for it are rejected` } };
  const row = [tenant.id, ev.event_id, ev.meter, ev.quantity, v.ms, Date.now()];
  db.events.push(row);
  index.set(key, row);
  return { code: 201, body: { status: "accepted", event_id: ev.event_id, period: v.period } };
}

// ---------------- invoices ----------------

function generateFor(tenant, period) {
  const existing = db.invoices.find((i) => i.tenant_id === tenant.id && i.period === period && i.status !== "void");
  if (existing && existing.status !== "draft") return "skipped_finalized";
  const est = estimate(tenant, period);
  const lines = est.lines;
  if (existing) {
    Object.assign(existing, {
      plan_id: est.plan_id, plan_name: est.plan_name, base_fee_paise: est.base_fee_paise,
      total_paise: est.total_paise, lines, created_at: nowIso(),
    });
    return "updated";
  }
  db.invoices.push({
    id: ++db.seq.invoice, number: null, tenant_id: tenant.id, period,
    plan_id: est.plan_id, plan_name: est.plan_name, status: "draft",
    base_fee_paise: est.base_fee_paise, total_paise: est.total_paise,
    created_at: nowIso(), finalized_at: null, paid_at: null, voided_at: null, void_reason: null, payment_method: null,
    lines,
  });
  return "created";
}

function findInvoiceFor(a, id) {
  const inv = db.invoices.find((i) => String(i.id) === String(id));
  // Another tenant's invoice is 404, not 403, so ids cannot be probed.
  if (!inv || (a.role === "tenant" && inv.tenant_id !== a.tenant.id)) fail(404, "not_found", "Invoice not found");
  return inv;
}

// ---------------- router ----------------

const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp("^" + pattern.replace(/\{(\w+)\}/g, "(?<$1>[^/]+)") + "$"), fn });

route("GET", "/me", async (a) => {
  requireAny(a);
  return { body: a.role === "admin" ? { role: "admin" } : { role: "tenant", tenant: { ...tenantOut(a.tenant), plan: planOut(planById(a.tenant.plan_id)) } } };
});

route("POST", "/events", async (a, q, body) => {
  const t = scopeTenant(a, q);
  const r = ingestOne(body, t);
  if (r.code >= 201 || r.code === 200) persist();
  return { status: r.code, body: r.body };
});

route("POST", "/events/batch", async (a, q, body) => {
  const t = scopeTenant(a, q);
  const list = body && body.events;
  if (!Array.isArray(list)) fail(400, "invalid_batch", "Body must be {events: [...]}");
  if (list.length > 1000) fail(400, "batch_too_large", "A batch can hold at most 1,000 events; nothing was stored");
  let accepted = 0, duplicates = 0;
  const rejected = [];
  list.forEach((ev, i) => {
    const r = ingestOne(ev, t);
    if (r.code === 201) accepted++;
    else if (r.code === 200) duplicates++;
    else rejected.push({ index: i, error: r.body.error, detail: r.body.detail });
  });
  if (accepted) persist();
  return { body: { accepted, duplicates, rejected } };
});

route("GET", "/events/recent", async (a, q) => {
  const t = scopeTenant(a, q, { optional: true });
  const limit = Math.min(100, parseInt(q.get("limit") || "20", 10) || 20);
  const out = [];
  for (let i = db.events.length - 1; i >= 0 && out.length < limit; i--) {
    const e = db.events[i];
    if (t && e[0] !== t.id) continue;
    if (e[5] > Date.now()) continue;
    out.push({ tenant_id: e[0], tenant_name: tenantById(e[0])?.name, event_id: e[1], meter: e[2], quantity: e[3], occurred_at: new Date(e[4]).toISOString(), received_at: new Date(e[5]).toISOString() });
  }
  return { body: out };
});

route("GET", "/usage", async (a, q) => {
  const t = scopeTenant(a, q);
  const period = checkPeriod(q);
  return { body: { tenant_id: t.id, period, meters: usageFor(t.id, period) } };
});

route("GET", "/usage/daily", async (a, q) => {
  const t = scopeTenant(a, q);
  const period = checkPeriod(q);
  const meter = q.get("meter") || "api_calls";
  if (!METER_IDS.includes(meter)) fail(400, "unknown_meter", "Unknown meter");
  const days = daysIn(period);
  const start = periodStart(period);
  const arr = Array.from({ length: days }, (_, i) => ({ day: new Date(start + i * 86400000).toISOString().slice(0, 10), quantity: 0 }));
  for (const e of db.events) {
    if (e[0] !== t.id || e[2] !== meter || periodOf(e[4]) !== period) continue;
    arr[new Date(e[4]).getUTCDate() - 1].quantity += e[3];
  }
  return { body: arr };
});

route("GET", "/usage/estimate", async (a, q) => {
  const t = scopeTenant(a, q);
  const period = checkPeriod(q, false);
  return { body: estimate(t, period) };
});

route("GET", "/usage/history", async (a, q) => {
  const t = scopeTenant(a, q);
  const periods = [...new Set(db.events.filter((e) => e[0] === t.id).map((e) => periodOf(e[4])))].sort();
  return { body: periods.map((p) => ({ period: p, meters: usageFor(t.id, p) })) };
});

route("GET", "/overview", async (a, q) => {
  requireAdmin(a);
  const period = checkPeriod(q, false);
  const usage = usageAll(period);
  const today = new Date().toISOString().slice(0, 10);
  let eventsToday = 0;
  const days = daysIn(period);
  const start = periodStart(period);
  const daily = Array.from({ length: days }, (_, i) => ({ day: new Date(start + i * 86400000).toISOString().slice(0, 10), api_calls: 0, emails_sent: 0 }));
  for (const e of db.events) {
    if (new Date(e[5]).toISOString().slice(0, 10) === today) eventsToday++;
    if (periodOf(e[4]) === period) daily[new Date(e[4]).getUTCDate() - 1][e[2]] += e[3];
  }
  const perTenant = db.tenants.map((t) => ({ tenant_id: t.id, name: t.name, plan_id: t.plan_id, estimate_paise: estimate(t, period, usage[t.id]).total_paise, usage: usage[t.id] }));
  const open = db.invoices.filter((i) => i.status === "finalized");
  return {
    body: {
      period,
      events_today: eventsToday,
      active_tenants: db.tenants.filter((t) => t.status === "active" && (usage[t.id].api_calls + usage[t.id].emails_sent) > 0).length,
      total_tenants: db.tenants.length,
      estimated_revenue_paise: perTenant.reduce((s, x) => s + x.estimate_paise, 0),
      open_invoices: open.length,
      open_invoices_paise: open.reduce((s, i) => s + i.total_paise, 0),
      totals: Object.values(usage).reduce((acc, u) => ({ api_calls: acc.api_calls + u.api_calls, emails_sent: acc.emails_sent + u.emails_sent }), { api_calls: 0, emails_sent: 0 }),
      daily,
      tenants: perTenant.sort((x, y) => y.estimate_paise - x.estimate_paise),
    },
  };
});

route("GET", "/plans", async () => ({ body: db.plans.filter((p) => p.active).map(planOut) }));
route("GET", "/plans/{id}", async (a, q, b, p) => {
  const plan = planById(p.id);
  if (!plan) fail(404, "not_found", "Plan not found");
  return { body: planOut(plan) };
});
route("POST", "/plans", async (a, q, body) => {
  requireAdmin(a);
  const { id, name, base_fee_paise, tiers } = body || {};
  if (typeof id !== "string" || !/^[a-z0-9_-]{2,32}$/.test(id)) fail(400, "invalid_plan", "id must be 2–32 lowercase letters, digits, - or _");
  if (typeof name !== "string" || !name.trim()) fail(400, "invalid_plan", "name is required");
  if (!Number.isInteger(base_fee_paise) || base_fee_paise < 0) fail(400, "invalid_plan", "base_fee_paise must be an integer ≥ 0");
  if (planById(id)) fail(409, "plan_exists", `A plan with id "${id}" already exists`);
  for (const m of METER_IDS) {
    const err = validateTiers(tiers && tiers[m]);
    if (err) fail(400, "invalid_tiers", `${m}: ${err.message}`);
  }
  const plan = { id, name: name.trim(), base_fee_paise, currency: "INR", active: 1, created_at: nowIso(), tiers: { api_calls: tiers.api_calls, emails_sent: tiers.emails_sent, pdf_links: tiers.pdf_links || [{ from: 1, to: null, per_1000: 2000000 }] } };
  db.plans.push(plan);
  persist();
  return { status: 201, body: planOut(plan) };
});

route("GET", "/tenants", async (a, q) => {
  requireAdmin(a);
  const period = checkPeriod(q, false);
  const usage = usageAll(period);
  return {
    body: db.tenants.map((t) => ({ ...tenantOut(t), period, usage: usage[t.id], estimate_paise: estimate(t, period, usage[t.id]).total_paise })),
  };
});
route("GET", "/tenants/{id}", async (a, q, b, p) => {
  requireAdmin(a);
  const t = tenantById(p.id);
  if (!t) fail(404, "not_found", "Tenant not found");
  return { body: tenantOut(t) };
});
route("POST", "/tenants", async (a, q, body) => {
  requireAdmin(a);
  const { id, name, plan_id } = body || {};
  if (typeof id !== "string" || !/^[a-z0-9_]{3,40}$/.test(id)) fail(400, "invalid_tenant", "id must be 3–40 lowercase letters, digits or _");
  if (typeof name !== "string" || !name.trim()) fail(400, "invalid_tenant", "name is required");
  if (tenantById(id)) fail(409, "tenant_exists", `Tenant "${id}" already exists`);
  if (!planById(plan_id)) fail(404, "plan_not_found", "Plan not found");
  const raw = "ml_" + tokenUrlSafe(24);
  const t = { id, name: name.trim(), plan_id, api_key_hash: await sha256(raw), key_prefix: raw.slice(0, 8), key_last4: raw.slice(-4), status: "active", created_at: nowIso() };
  db.tenants.push(t);
  persist();
  return { status: 201, body: { ...tenantOut(t), api_key: raw } };
});
route("PATCH", "/tenants/{id}", async (a, q, body, p) => {
  requireAdmin(a);
  const t = tenantById(p.id);
  if (!t) fail(404, "not_found", "Tenant not found");
  if (body && body.plan_id !== undefined) {
    if (!planById(body.plan_id)) fail(404, "plan_not_found", "Plan not found");
    t.plan_id = body.plan_id;
  }
  if (body && body.status !== undefined) {
    if (!["active", "suspended"].includes(body.status)) fail(400, "invalid_status", "status must be active or suspended");
    t.status = body.status;
  }
  persist();
  return { body: tenantOut(t) };
});

route("POST", "/invoices/generate", async (a, q, body) => {
  requireAdmin(a);
  const period = body && body.period;
  if (!PERIOD_RE.test(period || "")) fail(400, "bad_period", "period must look like 2026-09");
  if (periodStart(period) > Date.now()) fail(400, "future_period", "Cannot generate invoices for a future month");
  let list = db.tenants;
  if (body.tenant_id) {
    const t = tenantById(body.tenant_id);
    if (!t) fail(404, "not_found", "Tenant not found");
    list = [t];
  }
  const res = { created: 0, updated: 0, skipped_finalized: 0 };
  for (const t of list) res[generateFor(t, period)]++;
  persist();
  return { body: res };
});

route("GET", "/invoices", async (a, q) => {
  requireAny(a);
  const period = q.get("period");
  if (period && !PERIOD_RE.test(period)) fail(400, "bad_period", "period must look like 2026-09");
  const status = q.get("status");
  let list = db.invoices;
  if (a.role === "tenant") list = list.filter((i) => i.tenant_id === a.tenant.id);
  else if (q.get("tenant_id")) list = list.filter((i) => i.tenant_id === q.get("tenant_id"));
  if (period) list = list.filter((i) => i.period === period);
  if (status) list = list.filter((i) => i.status === status);
  return { body: list.slice().sort((x, y) => (y.period.localeCompare(x.period)) || ((x.number || "~").localeCompare(y.number || "~"))).map((i) => invoiceOut(i, false)) };
});

route("GET", "/invoices/{id}", async (a, q, b, p) => {
  requireAny(a);
  return { body: invoiceOut(findInvoiceFor(a, p.id)) };
});

route("POST", "/invoices/{id}/finalize", async (a, q, b, p) => {
  requireAdmin(a);
  const inv = findInvoiceFor(a, p.id);
  if (inv.status !== "draft") fail(409, "invalid_transition", `Only drafts can be finalized; this invoice is ${inv.status}`);
  const key = inv.period.replace("-", "");
  db.seq.numbers[key] = (db.seq.numbers[key] || 0) + 1;
  inv.number = `INV-${key}-${String(db.seq.numbers[key]).padStart(4, "0")}`;
  inv.status = "finalized";
  inv.finalized_at = nowIso();
  persist();
  return { body: invoiceOut(inv) };
});

route("POST", "/invoices/{id}/pay", async (a, q, body, p) => {
  requireAdmin(a);
  const inv = findInvoiceFor(a, p.id);
  if (inv.status !== "finalized") fail(409, "invalid_transition", `Only finalized invoices can be paid; this invoice is ${inv.status}`);
  inv.status = "paid";
  inv.paid_at = nowIso();
  inv.payment_method = (body && body.method) || "mock";
  persist();
  return { body: invoiceOut(inv) };
});

route("POST", "/invoices/{id}/void", async (a, q, body, p) => {
  requireAdmin(a);
  const inv = findInvoiceFor(a, p.id);
  if (inv.status !== "finalized") fail(409, "invalid_transition", `Only finalized invoices can be voided; this invoice is ${inv.status}`);
  const reason = body && typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) fail(400, "reason_required", "A reason is required to void an invoice");
  inv.status = "void";
  inv.voided_at = nowIso();
  inv.void_reason = reason.slice(0, 200);
  persist();
  return { body: invoiceOut(inv) };
});

route("GET", "/export/usage.csv", async (a, q) => {
  requireAdmin(a);
  const period = q.get("period");
  if (period && !PERIOD_RE.test(period)) fail(400, "bad_period", "period must look like 2026-09");
  const agg = new Map();
  for (const e of db.events) {
    const p = periodOf(e[4]);
    if (period && p !== period) continue;
    const day = new Date(e[4]).toISOString().slice(0, 10);
    const k = `${e[0]},${e[2]},${day}`;
    agg.set(k, (agg.get(k) || 0) + e[3]);
  }
  const rows = [...agg.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([k, v]) => `${k},${v}`);
  return { body: "tenant,meter,day,quantity\n" + rows.join("\n") + "\n", contentType: "text/csv" };
});

// ---------------- PDF links (₹20 per PDF) ----------------
// Mirrors POST /api/pdfs: the page keeps the file as a blob: URL (mock mode stores nothing on a
// server), and the upload is recorded as one pdf_links usage event so it is priced like any other.
const IDEM_RE = /^[A-Za-z0-9_-]{1,60}$/;
const pdfOut = (r) => ({ token: r.token, link: r.link, filename: r.filename, size_bytes: r.size_bytes, created_at: r.created_at, period: periodOf(Date.parse(r.created_at)) });

route("POST", "/pdfs", async (a, q, body) => {
  requireAny(a);
  if (a.role !== "tenant") fail(403, "tenant_only", "Upload PDFs with a tenant key");
  const t = a.tenant;
  const { filename, size_bytes, is_pdf, link, idempotency_key } = body || {};
  if (idempotency_key != null && !IDEM_RE.test(idempotency_key)) fail(400, "bad_idempotency_key", "Idempotency-Key must be 1 to 60 letters, digits, - or _");
  db.pdfs = db.pdfs || [];
  const token = await tokenUrlSafe(18);
  const eventId = "pdf-" + (idempotency_key || token);
  const existing = db.pdfs.find((r) => r.tenant_id === t.id && r.event_id === eventId);
  if (existing) return { status: 200, body: { ...pdfOut(existing), status: "duplicate", charged_paise: 0 } };
  if (!size_bytes) fail(400, "empty_file", "The file is empty");
  if (size_bytes > 10 * 1024 * 1024) fail(413, "file_too_large", "A PDF can be at most 10 MB");
  if (!is_pdf) fail(415, "not_a_pdf", "Only PDF files can be uploaded");
  const plan = planById(t.plan_id);
  if (!plan.tiers.pdf_links) fail(409, "pdf_not_priced", `The ${plan.name} plan has no price for PDF links`);
  const now = Date.now();
  const period = periodOf(now);
  if (isClosed(t.id, period)) fail(409, "period_closed", `The ${period} invoice is finalized; new charges for it are rejected`);
  const before = estimate(t, period).total_paise;
  const row = [t.id, eventId, "pdf_links", 1, now, now];
  db.events.push(row);
  index.set(t.id + "|" + eventId, row);
  const rec = { token, tenant_id: t.id, event_id: eventId, filename: String(filename || "document.pdf").slice(0, 120), size_bytes, link, created_at: new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z") };
  db.pdfs.push(rec);
  const after = estimate(t, period).total_paise;
  persist();
  return { status: 201, body: { ...pdfOut(rec), status: "accepted", charged_paise: after - before, estimate_total_paise: after } };
});

route("GET", "/pdfs", async (a, q) => {
  const t = scopeTenant(a, q);
  const period = q.get("period");
  const rows = (db.pdfs || []).filter((r) => r.tenant_id === t.id).map(pdfOut).filter((r) => !period || r.period === period);
  return { body: rows.reverse() };
});

// ---------------- entry ----------------

export async function handle(method, path, { headers = {}, body, query = "" } = {}) {
  await load();
  const q = new URLSearchParams(query);
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    try {
      const a = await resolveAuth(headers);
      const res = await r.fn(a, q, body, m.groups || {});
      return { status: res.status || 200, body: res.body, contentType: res.contentType || "application/json" };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: e.error, detail: e.detail } };
      console.error(e);
      return { status: 500, body: { error: "server_error", detail: String(e.message || e) } };
    }
  }
  return { status: 404, body: { error: "not_found", detail: `No route for ${method} ${path}` } };
}

export { tierLabel };
