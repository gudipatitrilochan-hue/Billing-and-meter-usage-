// S8 Event simulator — single events (201 / 200 duplicate / 409 / 400), the FR-03 batch,
// and the retry storm: N unique events × up to R repeats, shuffled, through batch calls from
// 4 concurrent workers, with a live particle view and the final "usage total = expected" check.
import { requireRole } from "../auth.js";
import { api } from "../api.js";
import { mountShell, el, qs, icon, toast, errorToast, currentPeriod, periodLabel } from "../ui.js";
import { countUp, reveal, pop, confetti, shake, reduced } from "../motion.js";
import { CONFIG } from "../config.js";
import { formatInt } from "../pricing.js";

const gsap = window.gsap;
requireRole(["admin"]);

const tenantSel = el("select", { class: "form-select ml-input", id: "sim-tenant", "aria-label": "Send as tenant" });
mountShell({ page: "simulator", title: "Event simulator", subtitle: "Prove that sending the same event many times never charges twice.", actions: [el("label", { class: "ml-label mb-0 me-1", for: "sim-tenant", text: "Send as" }), tenantSel] });

let tenants = [];
const rid = () => Math.random().toString(36).slice(2, 8);
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

// ---------------- terminal log ----------------
const term = qs("#term");
function log(code, msg) {
  if (term.querySelector(".ml-term__empty")) term.replaceChildren();
  const cls = code === 201 ? "c2" : code === 200 ? "c200" : "c4";
  const line = el("div", { class: "ml-term__line" },
    el("time", { text: new Date().toLocaleTimeString("en-GB") }),
    el("span", { class: `ml-term__code ${cls}`, text: String(code) }),
    el("span", { class: "ml-term__msg", text: msg }));
  term.append(line);
  while (term.children.length > 200) term.firstChild.remove();
  term.scrollTop = term.scrollHeight;
  if (gsap && !reduced) gsap.from(line, { x: -12, opacity: 0, duration: 0.35 });
}
qs("#term-clear").addEventListener("click", () => term.replaceChildren(el("div", { class: "ml-term__empty", text: "$ waiting for requests…" })));

/** Call the API and turn the outcome into (status, body) without throwing. */
async function send(path, body) {
  const tenant = tenantSel.value;
  try {
    const res = await api(path, { method: "POST", body, query: { tenant_id: tenant } });
    return { status: res.status === "accepted" ? 201 : 200, body: res };
  } catch (e) {
    return { status: e.status || 0, body: { error: e.error, detail: e.detail } };
  }
}

// ---------------- single event ----------------
const f = {
  id: qs("#ev-id"), meter: qs("#ev-meter"), qty: qs("#ev-qty"), ts: qs("#ev-ts"),
};
const newId = () => {
  const t = tenants.find((x) => x.id === tenantSel.value);
  const prefix = t ? t.id.replace(/^t_/, "").slice(0, 3) : "evt";
  f.id.value = `${prefix}-${new Date().toISOString().slice(0, 10)}-${rid()}`;
  if (gsap && !reduced) gsap.fromTo(f.id, { boxShadow: "0 0 0 6px rgba(134,239,172,.5)" }, { boxShadow: "0 0 0 0 rgba(134,239,172,0)", duration: 0.8, clearProps: "boxShadow" });
};
qs("#ev-gen").addEventListener("click", newId);
qs("#ev-now").addEventListener("click", () => (f.ts.value = nowIso()));

const eventFromForm = (over = {}) => ({
  event_id: f.id.value.trim(),
  meter: f.meter.value,
  quantity: Number(f.qty.value),
  timestamp: f.ts.value.trim(),
  ...over,
});

async function sendSingle(ev, note) {
  const r = await send("/events", ev);
  const label = `${ev.event_id} · ${ev.meter} × ${ev.quantity}`;
  if (r.status === 201) log(201, `accepted  ${label}${note ? "  (" + note + ")" : ""}`);
  else if (r.status === 200) log(200, `duplicate ${label} — ignored, usage unchanged`);
  else log(r.status, `${r.body.error}: ${r.body.detail}`);
  return r;
}

qs("#single-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!f.id.value.trim()) newId();
  const r = await sendSingle(eventFromForm());
  if (r.status >= 400) shake(qs("#single-form"));
});
qs("#ev-retry").addEventListener("click", () => sendSingle(eventFromForm(), "retry"));
qs("#ev-change").addEventListener("click", () => sendSingle(eventFromForm({ quantity: Number(f.qty.value) + 200 }), "same id, new quantity"));
qs("#ev-bad").addEventListener("click", () => sendSingle(eventFromForm({ event_id: `bad-${rid()}`, meter: "sms_sent" })));
qs("#ev-future").addEventListener("click", () => sendSingle(eventFromForm({ event_id: `fut-${rid()}`, timestamp: new Date(Date.now() + 3600000).toISOString() })));
qs("#ev-closed").addEventListener("click", () => {
  const d = new Date();
  const lastMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 10, 9)).toISOString();
  return sendSingle(eventFromForm({ event_id: `old-${rid()}`, timestamp: lastMonth }));
});

// ---------------- FR-03 batch ----------------
qs("#batch-fr03").addEventListener("click", async () => {
  const base = `b-${rid()}`;
  const ts = nowIso();
  const good = [1, 2, 3].map((i) => ({ event_id: `${base}-${i}`, meter: "api_calls", quantity: 100 * i, timestamp: ts }));
  // seed one event first, then resend it inside the batch as the duplicate
  await send("/events", good[0]);
  const events = [
    { ...good[0] },
    { event_id: `${base}-4`, meter: "api_calls", quantity: 50, timestamp: ts },
    good[1], good[2],
    { event_id: `${base}-5`, meter: "sms_sent", quantity: 5, timestamp: ts },
  ];
  // FR-03 example is 3 good / 1 duplicate / 1 bad meter
  const r = await send("/events/batch", { events });
  if (r.status >= 400) return log(r.status, `${r.body.error}: ${r.body.detail}`);
  log(200, `batch → accepted ${r.body.accepted} · duplicates ${r.body.duplicates} · rejected ${r.body.rejected.length} ${r.body.rejected.map((x) => `[#${x.index} ${x.error}]`).join(" ")}`);
});
qs("#batch-big").addEventListener("click", async () => {
  const events = Array.from({ length: 1001 }, (_, i) => ({ event_id: `x-${i}`, meter: "api_calls", quantity: 1, timestamp: nowIso() }));
  const r = await send("/events/batch", { events });
  log(r.status, r.status >= 400 ? `${r.body.error}: ${r.body.detail}` : "unexpected success");
});

// ---------------- retry storm ----------------
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const S = {
  unique: qs("#st-unique"), repeats: qs("#st-repeats"), workers: qs("#st-workers"), seed: qs("#st-seed"),
  start: qs("#st-start"), accepted: qs("#c-accepted"), dup: qs("#c-dup"), rej: qs("#c-rej"),
  bar: qs("#st-bar"), sent: qs("#st-sent"), check: qs("#st-check"), vault: qs("#st-vault"),
};
if (CONFIG.API_MODE === "mock") S.unique.value = "5000";

const fx = particleField(qs("#st-canvas"));

S.start.addEventListener("click", runStorm);

async function runStorm() {
  const unique = Math.max(1, Math.min(20000, parseInt(S.unique.value, 10) || 0));
  const maxRep = Math.max(1, Math.min(9, parseInt(S.repeats.value, 10) || 1));
  const workers = Math.max(1, Math.min(8, parseInt(S.workers.value, 10) || 4));
  const seed = parseInt(S.seed.value, 10) || 7;
  // Tenants whose current month is already finalized would (correctly) reject every event
  // with 409 period_closed, so the storm only uses tenants with an open period.
  let closed = new Set();
  try {
    const inv = await api("/invoices", { query: { period: currentPeriod() } });
    closed = new Set(inv.filter((i) => i.status === "finalized" || i.status === "paid").map((i) => i.tenant_id));
  } catch (e) { /* fall back to all active tenants */ }
  const pool = tenants.filter((t) => t.status === "active" && !closed.has(t.id)).slice(0, 4);
  if (!pool.length) return toast("Every active tenant's month is finalized — nothing can accept events. Void an invoice or reset demo data.", { type: "error" });
  qs("#st-pool").textContent = pool.map((t) => t.name).join(", ");

  S.start.disabled = true;
  S.start.replaceChildren(el("span", { class: "spinner-border spinner-border-sm", "aria-hidden": "true" }), "Storm running…");
  S.check.className = "ml-check";
  S.check.replaceChildren(el("span", { class: "ml-check__icon" }, icon("refresh", 16)), el("span", { text: "Taking a usage snapshot before the storm…" }));

  const period = currentPeriod();
  const r = rng(seed);
  const run = Date.now().toString(36);
  const start = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
  const end = Date.now() - 60000;
  // 1) unique events + expected totals
  const expected = Object.fromEntries(pool.map((t) => [t.id, { api_calls: 0, emails_sent: 0 }]));
  const byTenant = Object.fromEntries(pool.map((t) => [t.id, []]));
  for (let i = 0; i < unique; i++) {
    const t = pool[Math.floor(r() * pool.length)];
    const meter = r() < 0.8 ? "api_calls" : "emails_sent";
    const quantity = 1 + Math.floor(r() * 50);
    const ts = new Date(start + r() * Math.max(1000, end - start)).toISOString().replace(/\.\d{3}Z$/, "Z");
    const ev = { event_id: `storm-${seed}-${run}-${i}`, meter, quantity, timestamp: ts };
    expected[t.id][meter] += quantity;
    const reps = 1 + Math.floor(r() * maxRep);
    for (let k = 0; k < reps; k++) byTenant[t.id].push(ev);
  }
  // 2) shuffle each tenant's sends, cut into batches of 500, interleave tenants
  const batches = [];
  for (const [tid, sends] of Object.entries(byTenant)) {
    for (let i = sends.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [sends[i], sends[j]] = [sends[j], sends[i]]; }
    for (let i = 0; i < sends.length; i += 500) batches.push({ tid, events: sends.slice(i, i + 500) });
  }
  for (let i = batches.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [batches[i], batches[j]] = [batches[j], batches[i]]; }
  const totalSends = batches.reduce((s, b) => s + b.events.length, 0);

  // 3) snapshot before
  let before;
  try {
    before = Object.fromEntries(await Promise.all(pool.map(async (t) => [t.id, (await api("/usage", { query: { period, tenant_id: t.id } })).meters])));
  } catch (e) { errorToast(e); return resetBtn(); }

  // 4) fire with N concurrent workers
  const c = { accepted: 0, dup: 0, rej: 0, sent: 0 };
  for (const k of ["accepted", "dup", "rej"]) { S[k].dataset.value = 0; S[k].textContent = "0"; }
  S.vault.textContent = "0";
  S.check.replaceChildren(el("span", { class: "ml-check__icon" }, icon("bolt", 16)), el("span", { text: `Sending ${formatInt(totalSends)} requests for ${formatInt(unique)} unique events from ${workers} workers…` }));
  log(200, `storm start · ${formatInt(unique)} unique × 1–${maxRep} repeats = ${formatInt(totalSends)} sends · ${batches.length} batches · seed ${seed}`);
  const t0 = performance.now();
  let next = 0;
  let tick = 0;
  const reasons = {};
  const worker = async () => {
    while (next < batches.length) {
      const b = batches[next++];
      try {
        const res = await api("/events/batch", { method: "POST", body: { events: b.events }, query: { tenant_id: b.tid } });
        c.accepted += res.accepted; c.dup += res.duplicates; c.rej += res.rejected.length;
        for (const x of res.rejected) reasons[x.error] = (reasons[x.error] || 0) + 1;
        fx.burst(res.accepted, res.duplicates, res.rejected.length);
      } catch (e) {
        c.rej += b.events.length;
        fx.burst(0, 0, b.events.length);
      }
      c.sent += b.events.length;
      if (++tick % 2 === 0 || next >= batches.length) paint();
    }
  };
  const paint = () => {
    countUp(S.accepted, c.accepted, formatInt, { duration: 0.4 });
    countUp(S.dup, c.dup, formatInt, { duration: 0.4 });
    countUp(S.rej, c.rej, formatInt, { duration: 0.4 });
    countUp(S.vault, c.accepted, formatInt, { duration: 0.4 });
    S.sent.textContent = `${formatInt(c.sent)} / ${formatInt(totalSends)} sends`;
    const w = (c.sent / totalSends) * 100 + "%";
    if (gsap && !reduced) gsap.to(S.bar, { width: w, duration: 0.3 }); else S.bar.style.width = w;
  };
  await Promise.all(Array.from({ length: workers }, worker));
  paint();
  const secs = ((performance.now() - t0) / 1000).toFixed(1);

  // 5) snapshot after + compare
  const after = Object.fromEntries(await Promise.all(pool.map(async (t) => [t.id, (await api("/usage", { query: { period, tenant_id: t.id } })).meters])));
  let pass = c.accepted === unique;
  const lines = [];
  for (const t of pool) for (const m of ["api_calls", "emails_sent"]) {
    const delta = after[t.id][m] - before[t.id][m];
    const ok = delta === expected[t.id][m];
    if (!ok) pass = false;
    lines.push(`${t.name} ${m}: +${formatInt(delta)} (expected +${formatInt(expected[t.id][m])}) ${ok ? "✔" : "✘"}`);
  }
  const expTotal = Object.values(expected).reduce((s, x) => s + x.api_calls + x.emails_sent, 0);
  S.check.className = `ml-check ${pass ? "is-pass" : "is-fail"}`;
  S.check.replaceChildren(
    el("span", { class: "ml-check__icon" }, icon(pass ? "check" : "alert", 18)),
    el("div", {},
      el("strong", { text: pass ? `Usage total = expected · zero double counting` : "Mismatch — some sends were double counted or lost" }),
      el("div", { class: "ml-hint mt-1", text: `${formatInt(totalSends)} sends in ${secs}s → accepted ${formatInt(c.accepted)} (unique ${formatInt(unique)}), duplicates ${formatInt(c.dup)}, rejected ${formatInt(c.rej)}. Usage grew by exactly ${formatInt(expTotal)} units across ${pool.length} tenants.` })));
  pop(S.check.querySelector(".ml-check__icon"));
  log(pass ? 201 : 409, `storm done in ${secs}s · accepted=${c.accepted} duplicates=${c.dup} rejected=${c.rej} · ${pass ? "PASS" : "FAIL"}`);
  lines.forEach((l) => log(200, "  " + l));
  for (const [err, n] of Object.entries(reasons)) log(409, `  rejected ${formatInt(n)} × ${err}`);
  if (pass) {
    const rect = S.check.getBoundingClientRect();
    confetti(rect.left + 30, rect.top + 20, 40);
  }
  resetBtn();
}

function resetBtn() {
  S.start.disabled = false;
  S.start.replaceChildren(icon("bolt", 16), "Run retry storm");
}

/** Canvas particles: accepted dots fly into the ledger vault, duplicates bounce off the shield. */
function particleField(canvas) {
  const ctx = canvas.getContext("2d");
  const parts = [];
  let w = 0, h = 0, dpr = 1;
  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  new ResizeObserver(resize).observe(canvas);
  const accent = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#22c55e";
  let color = accent();
  window.addEventListener("ml:themechange", () => (color = accent()));

  const spawn = (kind) => {
    const y = 20 + Math.random() * (h - 60);
    parts.push({ kind, x: -6, y, vx: 2.4 + Math.random() * 2.6, vy: (h / 2 - y) * 0.004 + (Math.random() - 0.5) * 0.4, life: 1, r: kind === "ok" ? 2.6 : 2.1, bounced: false });
  };
  const step = () => {
    ctx.clearRect(0, 0, w, h);
    const shieldX = w - 130;
    // shield line
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(shieldX, 16); ctx.lineTo(shieldX, h - 40); ctx.stroke();
    ctx.setLineDash([]);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy;
      if (p.kind !== "ok" && !p.bounced && p.x >= shieldX - 4) { p.bounced = true; p.vx = -p.vx * 0.5; p.vy = (Math.random() - 0.5) * 3; }
      if (p.bounced) p.life -= 0.025;
      if (p.kind === "ok" && p.x > shieldX) { p.vy += (h / 2 - p.y) * 0.02; p.life -= 0.04; }
      if (p.life <= 0 || p.x > w + 10) { parts.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.kind === "ok" ? color : p.kind === "dup" ? "rgba(220,224,222,.75)" : "#f87171";
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      if (p.kind === "ok") { ctx.globalAlpha = Math.max(0, p.life) * 0.25; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  };
  if (gsap && !reduced) gsap.ticker.add(step);
  return {
    burst(ok, dup, rej) {
      if (reduced) return;
      const scale = Math.max(1, (ok + dup + rej) / 40);
      const n = (x) => Math.min(30, Math.ceil(x / scale));
      for (let i = 0; i < n(ok); i++) setTimeout(() => spawn("ok"), Math.random() * 400);
      for (let i = 0; i < n(dup); i++) setTimeout(() => spawn("dup"), Math.random() * 400);
      for (let i = 0; i < n(rej); i++) setTimeout(() => spawn("rej"), Math.random() * 400);
    },
  };
}

// ---------------- boot ----------------
try {
  tenants = await api("/tenants");
  tenantSel.replaceChildren(...tenants.map((t) => el("option", { value: t.id, text: `${t.name}${t.status === "suspended" ? " (suspended)" : ""}` })));
  qs("#st-pool").textContent = tenants.filter((t) => t.status === "active").slice(0, 4).map((t) => t.name).join(", ");
  qs("#st-period").textContent = periodLabel(currentPeriod());
  newId();
  f.ts.value = nowIso();
  reveal(document.querySelectorAll(".ml-sim-card, .ml-storm"), { stagger: 0.1 });
} catch (e) {
  if (e.status !== 401) errorToast(e, () => location.reload());
}
