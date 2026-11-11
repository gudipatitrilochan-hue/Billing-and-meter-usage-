// S9 Tenant portal — my usage this month (meters, free-tier bars, daily chart), my invoices,
// my API key (masked) and a sample curl.
import { requireRole } from "../auth.js";
import { api } from "../api.js";
import { mountShell, el, qs, icon, statusPill, load, errorToast, emptyState, periodLabel, currentPeriod, copyText } from "../ui.js";
import { countUp, reveal, splitWords } from "../motion.js";
import { METERS } from "../config.js";
import { renderMeterBars, renderLines } from "./shared.js";
import { formatINR, formatInt } from "../pricing.js";
import { barChart } from "../charts.js";

const session = requireRole(["tenant"]);
mountShell({ page: "portal" });
const period = currentPeriod();
let me, plan, chart = null, meter = "api_calls";

qs("#p-period").textContent = `Live · ${periodLabel(period)}`;

async function boot() {
  me = await api("/me");
  plan = me.tenant.plan;
  qs("#p-name").textContent = `Hi, ${me.tenant.name}`;
  splitWords(qs("#p-name"), 0.15);
  qs("#p-plan").textContent = `Estimate so far on the ${plan.name} plan — priced from every event we've received, each counted once.`;
  const [usage, estimate] = await Promise.all([api("/usage", { query: { period } }), api("/usage/estimate", { query: { period } })]);
  countUp(qs("#p-total"), estimate.total_paise, formatINR, { from: 0, duration: 1.8 });

  const banners = [];
  qs("#p-meters").replaceChildren(...METERS.map((m) => {
    const v = el("strong", { class: "ml-num", text: "0" });
    countUp(v, usage.meters[m.id], formatInt, { from: 0, delay: 0.2 });
    return el("div", { class: "ml-glass" },
      el("div", { class: "ml-kpi__label" }, el("span", { class: "ml-kpi__icon" }, icon(m.id === "api_calls" ? "code" : "mail", 14)), m.name),
      el("div", { class: "ml-kpi__value" }, v),
      el("div", { class: "mt-2" }, renderMeterBars(m.id, usage.meters[m.id], plan, banners, "tenant")));
  }));
  qs("#p-banners").replaceChildren(...banners);
  reveal([...banners, ...qs("#p-meters").children], { stagger: 0.1, delay: 0.2 });

  const lines = qs("#p-lines");
  lines.replaceChildren(renderLines(estimate), el("div", { class: "ml-estimate__total" }, el("span", { class: "ml-muted", text: "Total so far" }), el("strong", { class: "ml-num", text: formatINR(estimate.total_paise) })));

  renderKey();
  await loadChart();
}

async function loadChart() {
  const daily = (await api("/usage/daily", { query: { period, meter } })).slice(0, new Date().getUTCDate());
  const labels = daily.map((d) => String(Number(d.day.slice(8))));
  const data = daily.map((d) => d.quantity);
  if (!chart) chart = barChart(qs("#p-chart"), labels, data, { highlight: data.length - 1 });
  else chart.update(labels, data, data.length - 1);
}
document.querySelectorAll("#p-chips .ml-chip").forEach((b) => b.addEventListener("click", () => {
  meter = b.dataset.meter;
  document.querySelectorAll("#p-chips .ml-chip").forEach((x) => { x.classList.toggle("is-on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
  loadChart().catch(errorToast);
}));

async function loadInvoices(box) {
  const list = await api("/invoices");
  if (!list.length) { box.replaceChildren(emptyState({ title: "No invoices yet", body: "Your first invoice appears after the month closes." })); return; }
  const cards = list.map((i) => el("a", { class: "ml-invcard", href: `invoice.html?id=${i.id}` },
    el("span", { class: "ml-invcard__icon" }, icon("invoices", 18)),
    el("div", {}, el("span", { class: "fw-semibold", text: periodLabel(i.period) }), el("small", { text: i.number || "Draft" })),
    statusPill(i.status),
    el("strong", { text: formatINR(i.total_paise) })));
  box.replaceChildren(el("div", { class: "ml-invcards" }, ...cards));
  reveal(cards, { stagger: 0.06 });
}

function renderKey() {
  const masked = me.tenant.key_masked;
  qs("#p-key").textContent = masked;
  qs("#p-copy-key").addEventListener("click", () => copyText(session.key, "API key copied"));
  const base = location.origin + "/api";
  const curl = `curl -X POST ${base}/events \\\n  -H "X-Api-Key: ${masked}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"event_id": "${me.tenant.id.replace(/^t_/, "").slice(0, 3)}-${new Date().toISOString().slice(0, 10)}-0001",\n       "meter": "api_calls", "quantity": 500,\n       "timestamp": "${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}"}'`;
  const pre = qs("#p-curl");
  pre.textContent = curl;
  qs("#p-copy-curl").addEventListener("click", () => copyText(curl.replace(masked, session.key), "curl copied with your full key"));
}

try {
  await boot();
} catch (e) {
  if (e.status !== 401) errorToast(e, () => location.reload());
}
load(qs("#p-invoices"), () => loadInvoices(qs("#p-invoices")), { rows: 3 }).catch(() => {});
