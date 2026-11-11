// S3 Tenants — table with plan, this month's usage and estimate; search; New tenant (key shown once).
import { requireRole } from "../auth.js";
import { api } from "../api.js";
import { mountShell, el, qs, icon, avatar, load, statusPill, planBadge, openModal, copyText, errorToast, emptyState, currentPeriod, periodLabel } from "../ui.js";
import { reveal, pop, enhance, confetti, reduced } from "../motion.js";
import { formatINR, formatInt, freeAllowance } from "../pricing.js";

const gsap = window.gsap;
requireRole(["admin"]);

const search = el("input", { class: "form-control ml-input", type: "search", placeholder: "Search tenants…", "aria-label": "Search tenants", id: "tenant-search" });
const newBtn = el("button", { class: "btn ml-btn ml-btn--ink", type: "button", "data-magnetic": "0.2" }, icon("plus", 16), "New tenant");
mountShell({
  page: "tenants",
  title: "Tenants",
  subtitle: `Every customer company and what they've used in ${periodLabel(currentPeriod())}.`,
  actions: [el("label", { class: "ml-search" }, icon("search", 16), search), newBtn],
});

const box = qs("#tenants");
let tenants = [];
let plans = [];

async function fetchAll() {
  [tenants, plans] = await Promise.all([api("/tenants", { query: { period: currentPeriod() } }), api("/plans")]);
  render(true);
}

function render(animate = false) {
  const q = search.value.trim().toLowerCase();
  const list = tenants.filter((t) => !q || t.name.toLowerCase().includes(q) || t.id.includes(q) || t.plan_id.includes(q));
  qs("#tenant-count").textContent = q ? `${list.length} of ${tenants.length}` : `${tenants.length} tenants`;
  if (!tenants.length) {
    box.replaceChildren(emptyState({ title: "No tenants yet", body: "Create the first customer company to issue it an API key.", action: { label: "New tenant", onClick: openNew } }));
    return;
  }
  if (!list.length) {
    box.replaceChildren(emptyState({ title: "No matches", body: `Nothing matches "${search.value}".` }));
    return;
  }
  const rows = list.map((t) => {
    const plan = plans.find((p) => p.id === t.plan_id);
    const allowance = plan ? freeAllowance(plan.tiers.api_calls) : 0;
    const near = allowance && t.usage.api_calls >= allowance * 0.8;
    const href = `tenant.html?id=${encodeURIComponent(t.id)}`;
    const tr = el("tr", { class: "is-link", onclick: (e) => { if (!e.target.closest("a")) qs("a", tr).click(); } },
      el("td", { "data-label": "" }, el("div", { class: "ml-cell-name" }, avatar(t.name),
        el("div", {}, el("a", { class: "ml-rowlink", href, text: t.name }), el("small", { text: t.id })))),
      el("td", { "data-label": "Plan" }, planBadge(t.plan_id, plans)),
      el("td", { class: "r ml-num", "data-label": "API calls" }, formatInt(t.usage.api_calls),
        near ? el("span", { class: "ms-2 ml-status ml-status--draft", title: `Past 80% of the ${formatInt(allowance)} free calls` }, el("i"), t.usage.api_calls > allowance ? "over free" : "80%+") : null),
      el("td", { class: "r ml-num", "data-label": "Emails" }, formatInt(t.usage.emails_sent)),
      el("td", { class: "r ml-num", "data-label": "Estimate" }, el("strong", { text: formatINR(t.estimate_paise) })),
      el("td", { "data-label": "Status" }, statusPill(t.status)));
    return tr;
  });
  const total = list.reduce((s, t) => s + t.estimate_paise, 0);
  const table = el("table", { class: "ml-table ml-table--cards" },
    el("caption", { class: "visually-hidden", text: "Tenants with usage this month" }),
    el("thead", {}, el("tr", {}, ...["Tenant", "Plan", "API calls", "Emails", "Estimate", "Status"].map((h, i) => el("th", { scope: "col", class: [2, 3, 4].includes(i) ? "r" : "", text: h })))),
    el("tbody", {}, ...rows),
    el("tfoot", {}, el("tr", {}, el("td", { colspan: "4", "data-label": "", text: "Total estimate" }), el("td", { class: "r ml-num", "data-label": "Total", text: formatINR(total) }), el("td", { "data-label": "" }))));
  box.replaceChildren(el("div", { class: "ml-tablewrap" }, table));
  if (animate) reveal(rows, { stagger: 0.035, y: 12 });
}

let t;
search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => render(true), 120); });

// ---------- New tenant ----------
function slug(name) {
  return "t_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 30);
}

function openNew() {
  const name = el("input", { class: "form-control ml-input", id: "nt-name", required: true, maxlength: "60", placeholder: "e.g. Acme SMS", autocomplete: "off" });
  const id = el("input", { class: "form-control ml-input ml-input--mono", id: "nt-id", required: true, maxlength: "40", placeholder: "t_acmesms", pattern: "[a-z0-9_]{3,40}" });
  const plan = el("select", { class: "form-select ml-input", id: "nt-plan" }, ...plans.map((p) => el("option", { value: p.id, text: `${p.name} — ${formatINR(p.base_fee_paise)} / month` })));
  plan.value = "starter";
  let idTouched = false;
  name.addEventListener("input", () => { if (!idTouched) id.value = slug(name.value); });
  id.addEventListener("input", () => (idTouched = true));
  const err = el("div", { class: "ml-hint text-danger", role: "alert" });
  const form = el("form", { novalidate: true, id: "nt-form" },
    el("div", { class: "ml-field" }, el("label", { class: "ml-label", for: "nt-name", text: "Company name" }), name),
    el("div", { class: "ml-field" }, el("label", { class: "ml-label", for: "nt-id", text: "Tenant id" }), id, el("div", { class: "ml-hint", text: "Lowercase letters, digits and _. Used in URLs and exports." })),
    el("div", { class: "ml-field" }, el("label", { class: "ml-label", for: "nt-plan", text: "Pricing plan" }), plan),
    err);
  const submit = el("button", { class: "btn ml-btn ml-btn--ink", type: "submit", form: "nt-form" }, "Create tenant");
  const m = openModal({ title: "New tenant", body: form, footer: [el("button", { class: "btn ml-btn ml-btn--ghost", type: "button", "data-bs-dismiss": "modal" }, "Cancel"), submit] });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    if (!name.value.trim()) { name.classList.add("is-invalid"); name.focus(); return; }
    submit.disabled = true;
    try {
      const created = await api("/tenants", { method: "POST", body: { id: id.value.trim(), name: name.value.trim(), plan_id: plan.value } });
      showKey(m, created);
      await fetchAll();
    } catch (ex) {
      submit.disabled = false;
      err.textContent = ex.detail || "Could not create tenant";
    }
  });
}

/** The raw key is shown exactly once (PRD FR-09); only its hash is stored. */
function showKey(m, created) {
  const body = m.body.querySelector(".modal-body");
  const footer = m.body.querySelector(".modal-footer");
  m.body.querySelector(".modal-title").textContent = `${created.name} is ready`;
  const keyBox = el("div", { class: "ml-keybox", id: "new-key" }, created.api_key);
  const copy = el("button", { class: "btn ml-btn ml-btn--accent w-100 mt-3", type: "button", onclick: async () => {
    if (await copyText(created.api_key, "API key copied")) { copy.replaceChildren(icon("check", 16), "Copied"); done.disabled = false; }
  } }, icon("copy", 16), "Copy API key");
  const done = el("button", { class: "btn ml-btn ml-btn--ink", type: "button", "data-bs-dismiss": "modal", disabled: true }, "I've saved it");
  const skip = el("button", { class: "btn ml-btn ml-btn--ghost", type: "button", onclick: () => (done.disabled = false) }, "Show done button");
  body.replaceChildren(
    el("div", { class: "ml-banner" }, icon("alert", 18), el("div", {}, el("strong", { text: "Copy this key now. " }), "It is shown once and never stored — MeterLedger keeps only its SHA-256 hash.")),
    keyBox, copy);
  footer.replaceChildren(skip, done);
  pop(keyBox);
  const r = keyBox.getBoundingClientRect();
  confetti(r.left + r.width / 2, r.top + 10, 30);
}

newBtn.addEventListener("click", openNew);

try {
  await load(box, fetchAll, { rows: 8 });
} catch (e) { /* error state already rendered */ }
enhance(document);
