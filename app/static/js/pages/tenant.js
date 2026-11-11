// S4 Tenant detail — plan + change plan, month picker, meter totals, free-tier bars,
// daily usage chart, and the "estimate so far" invoice preview.
import { requireRole } from "../auth.js";
import { api } from "../api.js";
import { mountShell, el, qs, icon, avatar, statusPill, monthPicker, currentPeriod, periodLabel, toast, errorToast, errorState, skeleton, param, confirmModal } from "../ui.js";
import { countUp, reveal, pop } from "../motion.js";
import { METERS } from "../config.js";
import { renderMeterBars, renderLines } from "./shared.js";
import { formatINR, formatInt } from "../pricing.js";
import { barChart } from "../charts.js";

requireRole(["admin"]);
const id = param("id");
const picker = monthPicker(currentPeriod(), (p) => loadMonth(p));
mountShell({ page: "tenants", title: "Tenant", subtitle: " ", actions: [picker.el] });
qs(".ml-pagehead").before(el("a", { class: "ml-crumb", href: "tenants.html" }, icon("back", 15), "All tenants"));

let tenant, plans, plan;
let meter = "api_calls";
let chart = null;
let period = picker.value;

async function init() {
  if (!id) throw Object.assign(new Error("No tenant id"), { detail: "No tenant id in the URL" });
  [tenant, plans] = await Promise.all([api(`/tenants/${encodeURIComponent(id)}`), api("/plans")]);
  plan = plans.find((p) => p.id === tenant.plan_id);
  document.title = `${tenant.name} · MeterLedger`;
  const h1 = qs(".ml-h1");
  h1.replaceChildren(avatar(tenant.name), " ", tenant.name);
  h1.classList.add("d-flex", "align-items-center", "gap-2");
  qs(".ml-pagehead__sub").textContent = `${tenant.id} · key ${tenant.key_masked}`;
  renderHead();
}

function renderHead() {
  const sel = el("select", { class: "form-select ml-input", id: "plan-select", "aria-label": "Plan" }, ...plans.map((p) => el("option", { value: p.id, text: `${p.name} · ${formatINR(p.base_fee_paise)}` })));
  sel.value = tenant.plan_id;
  const save = el("button", { class: "btn ml-btn ml-btn--ink ml-btn--sm", type: "button", disabled: true }, "Change plan");
  sel.addEventListener("change", () => (save.disabled = sel.value === tenant.plan_id));
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      tenant = await api(`/tenants/${encodeURIComponent(tenant.id)}`, { method: "PATCH", body: { plan_id: sel.value } });
      plan = plans.find((p) => p.id === tenant.plan_id);
      toast(`${tenant.name} moved to ${plan.name}. The next draft uses it (no proration).`, { type: "success" });
      renderHead();
      loadMonth(period);
    } catch (e) { errorToast(e); save.disabled = false; }
  });
  const suspended = tenant.status === "suspended";
  const toggle = el("button", { class: `btn ml-btn ml-btn--sm ${suspended ? "ml-btn--accent" : "ml-btn--ghost"}`, type: "button" }, suspended ? "Reactivate" : "Suspend");
  toggle.addEventListener("click", async () => {
    if (!suspended) {
      const ok = await confirmModal({ title: `Suspend ${tenant.name}?`, message: "Their API key will get 403 tenant_suspended on every request until you reactivate them.", confirmLabel: "Suspend", danger: true });
      if (!ok) return;
    }
    try {
      tenant = await api(`/tenants/${encodeURIComponent(tenant.id)}`, { method: "PATCH", body: { status: suspended ? "active" : "suspended" } });
      toast(`${tenant.name} is now ${tenant.status}`, { type: "success" });
      renderHead();
    } catch (e) { errorToast(e); }
  });
  const head = qs("#tenant-head");
  head.replaceChildren(
    el("div", { class: "ml-stat" }, el("span", { class: "ml-stat__label", text: "Status" }), el("div", {}, statusPill(tenant.status))),
    el("div", { class: "ml-stat" }, el("span", { class: "ml-stat__label", text: "Current plan" }), el("strong", { text: `${plan.name} — ${formatINR(plan.base_fee_paise)} / month` })),
    el("div", { class: "ml-stat" }, el("span", { class: "ml-stat__label", text: "Customer since" }), el("strong", { text: new Date(tenant.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) })),
    el("div", { class: "ml-planrow ms-auto" }, el("label", { class: "visually-hidden", for: "plan-select", text: "Plan" }), sel, save, toggle));
}

async function loadMonth(p) {
  period = p;
  const isCurrent = p === currentPeriod();
  const meters = qs("#meters");
  const est = qs("#estimate");
  meters.replaceChildren(skeleton(3));
  est.replaceChildren(skeleton(5));
  try {
    const [usage, estimate, invoices] = await Promise.all([
      api("/usage", { query: { period: p, tenant_id: tenant.id } }),
      api("/usage/estimate", { query: { period: p, tenant_id: tenant.id } }),
      api("/invoices", { query: { period: p, tenant_id: tenant.id } }),
    ]);
    renderMeters(usage.meters, isCurrent);
    const inv = invoices.find((i) => i.status !== "void");
    renderEstimate(estimate, inv, isCurrent);
    loadChart();
  } catch (e) {
    meters.replaceChildren(errorState(e, () => loadMonth(p)));
    est.replaceChildren();
  }
}

function renderMeters(m, isCurrent) {
  const box = qs("#meters");
  const banners = [];
  const cards = METERS.map((mt) => {
    const value = el("div", { class: "ml-stat__value", text: "0" });
    const card = el("div", { class: "ml-card" },
      el("div", { class: "ml-stat" }, el("span", { class: "ml-stat__label" }, icon(mt.id === "api_calls" ? "code" : "mail", 15), `${mt.name} · ${periodLabel(period)}`), value),
      el("div", { class: "mt-3" }, renderMeterBars(mt.id, m[mt.id], plan, banners)));
    countUp(value, m[mt.id], formatInt, { from: 0 });
    return card;
  });
  const wrap = el("div", { class: "ml-grid-2" }, ...cards);
  box.replaceChildren(...(isCurrent ? banners : []), wrap);
  reveal([...banners, ...cards], { stagger: 0.08 });
}

function renderEstimate(estimate, inv, isCurrent) {
  const box = qs("#estimate");
  const finalized = inv && inv.status !== "draft";
  const title = finalized ? `Invoice ${inv.number}` : isCurrent ? "Estimate so far" : inv ? "Draft invoice" : "Estimate (not invoiced)";
  const total = el("strong", { class: "ml-num", text: formatINR(0) });
  const children = [
    el("div", { class: "ml-card__head" },
      el("div", {}, el("h2", { class: "ml-h2", text: title }), el("p", { class: "ml-card__sub", text: finalized ? `Locked on ${new Date(inv.finalized_at).toLocaleDateString("en-GB")}. Lines are a snapshot.` : `Priced on ${estimate.plan_name}. Preview only — not saved.` })),
      inv ? el("div", { class: "d-flex align-items-center gap-2" }, statusPill(inv.status), el("a", { class: "btn ml-btn ml-btn--ghost ml-btn--sm", href: `invoice.html?id=${inv.id}` }, "Open", icon("arrow", 14))) : null),
    renderLines(finalized ? { lines: inv.lines, base_fee_paise: inv.base_fee_paise } : estimate),
    el("div", { class: "ml-estimate__total" }, el("span", { class: "ml-muted", text: finalized ? "Invoice total" : "Total so far" }), total),
  ];
  box.replaceChildren(...children);
  countUp(total, finalized ? inv.total_paise : estimate.total_paise, formatINR, { from: 0, duration: 1 });
  reveal(box.querySelectorAll("tbody tr"), { stagger: 0.04, y: 8 });
}

async function loadChart() {
  const daily = await api("/usage/daily", { query: { period, meter, tenant_id: tenant.id } });
  const isCurrent = period === currentPeriod();
  const today = new Date().getUTCDate();
  const rows = isCurrent ? daily.slice(0, today) : daily;
  const labels = rows.map((d) => String(Number(d.day.slice(8))));
  const data = rows.map((d) => d.quantity);
  const hi = isCurrent ? rows.length - 1 : -1;
  if (!chart) chart = barChart(qs("#daily-chart"), labels, data, { highlight: hi });
  else chart.update(labels, data, hi);
  qs("#chart-total").textContent = `${formatInt(data.reduce((a, b) => a + b, 0))} ${meter === "api_calls" ? "calls" : "emails"} · peak ${formatInt(Math.max(0, ...data))}/day`;
}

document.querySelectorAll("#meter-chips .ml-chip").forEach((b) => b.addEventListener("click", () => {
  meter = b.dataset.meter;
  document.querySelectorAll("#meter-chips .ml-chip").forEach((x) => { x.classList.toggle("is-on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
  loadChart().catch(errorToast);
}));

try {
  qs("#tenant-head").replaceChildren(skeleton(2));
  await init();
  await loadMonth(period);
} catch (e) {
  qs("#tenant-body").replaceChildren(errorState(e.status ? e : { detail: e.detail || e.message }, () => location.reload()));
}
