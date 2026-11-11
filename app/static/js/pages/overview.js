// S2 Overview — KPI cards, live revenue estimate, daily usage curve, recent events, top tenants.
import { requireRole } from "../auth.js";
import { api } from "../api.js";
import { mountShell, el, qs, icon, avatar, load, errorToast, periodLabel, currentPeriod, emptyState } from "../ui.js";
import { countUp, reveal, enhance, reduced } from "../motion.js";
import { formatINR, formatInt } from "../pricing.js";
import { areaChart } from "../charts.js";

const gsap = window.gsap;
requireRole(["admin"]);
mountShell({
  page: "overview",
  title: "Overview",
  subtitle: "Usage and revenue across every tenant, priced live from metered events.",
  actions: [el("a", { class: "btn ml-btn ml-btn--ghost", href: "simulator.html" }, icon("bolt", 16), "Send events")],
});

const period = currentPeriod();
qs("#hero-period").textContent = `Live · ${periodLabel(period)}`;

const KPIS = [
  { id: "events_today", label: "Events today", icon: "bolt", fmt: formatInt, foot: (d) => `${formatInt(d.totals.api_calls)} calls this month` },
  { id: "active_tenants", label: "Active tenants", icon: "tenants", fmt: formatInt, foot: (d) => `of ${d.total_tenants} total` },
  { id: "estimated_revenue_paise", label: "Est. revenue this month", icon: "portal", fmt: formatINR, foot: () => "base fees + metered tiers" },
  { id: "open_invoices", label: "Open invoices", icon: "invoices", fmt: formatInt, foot: (d) => `${formatINR(d.open_invoices_paise)} awaiting payment` },
];

const kpiWrap = qs("#kpis");
const kpiEls = {};
for (const k of KPIS) {
  const value = el("div", { class: "ml-kpi__value", text: "—" });
  const foot = el("div", { class: "ml-kpi__foot", text: " " });
  kpiEls[k.id] = { value, foot, k };
  kpiWrap.append(el("div", { class: "ml-glass", "data-tilt": "4" },
    el("div", { class: "ml-kpi__label" }, el("span", { class: "ml-kpi__icon" }, icon(k.icon, 14)), k.label), value, foot));
}

let chart = null;
let first = true;

async function refresh() {
  const d = await api("/overview", { query: { period } });
  countUp(qs("#hero-revenue"), d.estimated_revenue_paise, formatINR, { duration: first ? 1.8 : 0.8 });
  for (const { value, foot, k } of Object.values(kpiEls)) {
    countUp(value, d[k.id], k.fmt, { duration: first ? 1.4 : 0.6, delay: first ? 0.2 : 0 });
    foot.textContent = k.foot(d);
  }
  const today = new Date().getUTCDate();
  const days = d.daily.slice(0, today);
  const labels = days.map((x) => new Date(x.day + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }));
  const values = days.map((x) => x.api_calls);
  if (!chart) chart = areaChart(qs("#hero-chart"), labels, values, { label: "API calls" });
  else chart.update(labels, values);
  renderRank(d.tenants);
  if (first) {
    reveal(kpiWrap.children, { stagger: 0.08, delay: 0.15 });
    enhance(kpiWrap);
  }
  first = false;
}

function renderRank(list) {
  const rank = qs("#rank");
  const max = Math.max(1, ...list.map((t) => t.estimate_paise));
  rank.replaceChildren(...list.slice(0, 6).map((t) => {
    const bar = el("i");
    const li = el("li", {},
      avatar(t.name),
      el("div", {}, el("a", { class: "ml-rank__name", href: `tenant.html?id=${encodeURIComponent(t.tenant_id)}`, text: t.name }),
        el("div", { class: "ml-rank__bar" }, bar)),
      el("strong", { class: "ml-num", text: formatINR(t.estimate_paise) }));
    requestAnimationFrame(() => {
      const w = (t.estimate_paise / max) * 100 + "%";
      if (gsap && !reduced) gsap.to(bar, { width: w, duration: 1.2, ease: "expo.out", delay: 0.3 });
      else bar.style.width = w;
    });
    return li;
  }));
}

let seen = new Set();
async function refreshFeed(container) {
  const events = await api("/events/recent", { query: { limit: 20 } });
  if (!events.length) {
    container.replaceChildren(emptyState({ title: "No events yet this month", body: "Send one from the simulator or with the sample curl.", action: { label: "Open simulator", href: "simulator.html" } }));
    return;
  }
  const fresh = seen.size > 0;
  const rows = events.map((e) => {
    const key = e.tenant_id + e.event_id;
    const tr = el("tr", { class: fresh && !seen.has(key) ? "ml-newrow" : "" },
      el("td", { "data-label": "Tenant" }, el("div", { class: "ml-cell-name" }, avatar(e.tenant_name || e.tenant_id), el("div", {}, el("span", { text: e.tenant_name || e.tenant_id }), el("small", { text: e.event_id })))),
      el("td", { "data-label": "Meter" }, el("span", { class: "ml-meter-tag" }, icon(e.meter === "api_calls" ? "code" : "mail", 14), e.meter === "api_calls" ? "API calls" : "Emails")),
      el("td", { class: "r ml-num", "data-label": "Quantity", text: formatInt(e.quantity) }),
      el("td", { class: "r ml-muted", "data-label": "Received", text: timeAgo(e.received_at) }));
    return tr;
  });
  seen = new Set(events.map((e) => e.tenant_id + e.event_id));
  const table = el("table", { class: "ml-table ml-table--cards ml-feed" },
    el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Tenant / event" }), el("th", { scope: "col", text: "Meter" }), el("th", { scope: "col", class: "r", text: "Quantity" }), el("th", { scope: "col", class: "r", text: "Received" }))),
    el("tbody", {}, ...rows));
  container.replaceChildren(el("div", { class: "ml-tablewrap" }, table));
  if (!fresh) reveal(rows, { stagger: 0.025, y: 10 });
}

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const feed = qs("#feed");
try {
  await Promise.all([refresh(), load(feed, () => refreshFeed(feed), { rows: 6 })]);
} catch (e) {
  if (e.status !== 401) errorToast(e, () => location.reload());
}

// Light polling keeps the console live without websockets.
setInterval(() => {
  if (document.hidden) return;
  refresh().catch(() => {});
  refreshFeed(feed).catch(() => {});
}, 15000);
