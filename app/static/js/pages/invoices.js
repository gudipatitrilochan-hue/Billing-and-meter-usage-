// S6 Invoices — month picker, one-click "Generate drafts", status filter, lifecycle actions,
// totals row and CSV export.
import { requireRole } from "../auth.js";
import { api } from "../api.js";
import { mountShell, el, qs, qsa, icon, avatar, load, statusPill, monthPicker, shiftPeriod, currentPeriod, periodLabel, toast, errorToast, emptyState, confirmModal, downloadText, param } from "../ui.js";
import { reveal, pop, confetti, enhance, reduced } from "../motion.js";
import { formatINR } from "../pricing.js";

const gsap = window.gsap;
requireRole(["admin"]);

const initial = /^\d{4}-\d{2}$/.test(param("period") || "") ? param("period") : shiftPeriod(currentPeriod(), -1);
const picker = monthPicker(initial, (p) => { period = p; history.replaceState(null, "", `?period=${p}`); refresh(true); });
const genBtn = el("button", { class: "btn ml-btn ml-btn--ink", type: "button", "data-magnetic": "0.2" }, icon("refresh", 16), "Generate drafts");
const exportBtn = el("button", { class: "btn ml-btn ml-btn--ghost", type: "button" }, icon("download", 16), "Export CSV");
mountShell({ page: "invoices", title: "Invoices", subtitle: "Draft → finalized → paid. Finalized invoices are locked and numbered.", actions: [picker.el, exportBtn, genBtn] });

let period = initial;
let filter = "all";
let invoices = [];
const box = qs("#invoices");

async function refresh(animate = false) {
  invoices = await api("/invoices", { query: { period } });
  render(animate);
}

function counts() {
  const c = { all: invoices.length, draft: 0, finalized: 0, paid: 0, void: 0 };
  for (const i of invoices) c[i.status]++;
  return c;
}

function renderChips() {
  const c = counts();
  const chips = qs("#status-chips");
  chips.replaceChildren(...["all", "draft", "finalized", "paid", "void"].map((s) =>
    el("button", { class: `ml-chip ${filter === s ? "is-on" : ""}`, type: "button", "aria-pressed": String(filter === s), onclick: () => { filter = s; render(true); } },
      s === "all" ? "All" : s[0].toUpperCase() + s.slice(1), el("span", { class: "ml-chip__n", text: String(c[s]) }))));
}

function render(animate = false) {
  renderChips();
  qs("#period-label").textContent = periodLabel(period);
  const list = invoices.filter((i) => filter === "all" || i.status === filter);
  if (!invoices.length) {
    box.replaceChildren(emptyState({ title: `No invoices for ${periodLabel(period)}`, body: "Generate drafts to price every tenant's usage for this month. You can regenerate drafts as often as you like until you finalize.", action: { label: "Generate drafts", onClick: generate } }));
    reveal(box.children);
    return;
  }
  if (!list.length) {
    box.replaceChildren(emptyState({ title: `No ${filter} invoices`, body: "Try another status filter." }));
    return;
  }
  const rows = list.map(row);
  const sum = (st) => list.filter((i) => !st || st.includes(i.status)).reduce((s, i) => s + i.total_paise, 0);
  const table = el("table", { class: "ml-table ml-table--cards" },
    el("caption", { class: "visually-hidden", text: `Invoices for ${periodLabel(period)}` }),
    el("thead", {}, el("tr", {}, ...["Number", "Tenant", "Plan", "Total", "Status", ""].map((h, i) => el("th", { scope: "col", class: i === 3 || i === 5 ? "r" : i === 2 ? "ml-hide-md" : "", text: h })))),
    el("tbody", {}, ...rows),
    el("tfoot", {}, el("tr", {},
      el("td", { colspan: "2", "data-label": "" }, `Totals · ${list.length} invoice${list.length === 1 ? "" : "s"}`, el("span", { class: "ms-2 ml-muted fw-normal", text: `(paid ${formatINR(sum(["paid"]))} · open ${formatINR(sum(["finalized"]))})` })),
      el("td", { class: "ml-hide-md", "data-label": "" }),
      el("td", { class: "r ml-num", "data-label": "Total (excl. void)", text: formatINR(list.filter((i) => i.status !== "void").reduce((s, i) => s + i.total_paise, 0)) }),
      el("td", { colspan: "2", "data-label": "" }))));
  box.replaceChildren(el("div", { class: "ml-tablewrap" }, table));
  if (animate) reveal(rows, { stagger: 0.03, y: 10 });
  enhance(box);
}

function row(inv) {
  const href = `invoice.html?id=${inv.id}`;
  const actions = el("div", { class: "ml-actions" });
  const btn = (label, variant, fn) => el("button", { class: `btn ml-btn ml-btn--sm ${variant}`, type: "button", onclick: (e) => { e.stopPropagation(); fn(e); } }, label);
  if (inv.status === "draft") actions.append(btn("Finalize", "ml-btn--ink", (e) => act(inv, "finalize", e)));
  if (inv.status === "finalized") actions.append(btn("Mark paid", "ml-btn--accent", (e) => act(inv, "pay", e)), btn("Void", "ml-btn--ghost", (e) => act(inv, "void", e)));
  if (!actions.children.length) actions.append(el("a", { class: "btn ml-btn ml-btn--sm ml-btn--ghost", href, "aria-label": `Open invoice for ${inv.tenant_name}` }, "Open"));
  const tr = el("tr", { "data-id": inv.id, class: "is-link", onclick: (e) => { if (!e.target.closest("a,button")) qs("a.ml-rowlink", tr).click(); } },
    el("td", { "data-label": "Number" }, el("a", { class: "ml-rowlink ml-mono", href, text: inv.number || "Draft" })),
    el("td", { "data-label": "Tenant" }, el("div", { class: "ml-cell-name" }, avatar(inv.tenant_name), el("span", { text: inv.tenant_name }))),
    el("td", { "data-label": "Plan", class: "ml-muted ml-hide-md", text: inv.plan_name }),
    el("td", { class: "r ml-num", "data-label": "Total" }, el("strong", { text: formatINR(inv.total_paise) })),
    el("td", { "data-label": "Status" }, statusPill(inv.status)),
    el("td", { class: "r", "data-label": "" }, actions));
  return tr;
}

async function act(inv, action, e) {
  let body;
  if (action === "void") {
    const reason = await confirmModal({ title: `Void ${inv.number}?`, message: "Voiding cancels the invoice permanently. The period can then be regenerated as a new draft.", confirmLabel: "Void invoice", danger: true, input: { label: "Reason", placeholder: "e.g. billed on the wrong plan" } });
    if (!reason) return;
    body = { reason };
  }
  if (action === "pay") body = { method: "mock" };
  const x = e.clientX, y = e.clientY;
  try {
    const updated = await api(`/invoices/${inv.id}/${action}`, { method: "POST", body });
    Object.assign(inv, updated);
    const old = qs(`tr[data-id="${inv.id}"]`);
    const fresh = row(inv);
    old.replaceWith(fresh);
    renderChips();
    pop(qs(".ml-status", fresh));
    if (action === "finalize") toast(`Finalized as ${updated.number}. New events for ${periodLabel(inv.period)} are now rejected for ${inv.tenant_name}.`, { type: "success" });
    if (action === "pay") { toast(`${updated.number} marked paid`, { type: "success" }); confetti(x, y); }
    if (action === "void") toast(`${updated.number} voided`, { type: "info" });
  } catch (err) { errorToast(err); }
}

async function generate() {
  genBtn.disabled = true;
  const label = [...genBtn.childNodes];
  genBtn.replaceChildren(el("span", { class: "spinner-border spinner-border-sm", "aria-hidden": "true" }), "Generating…");
  try {
    const r = await api("/invoices/generate", { method: "POST", body: { period } });
    toast(`${r.created} created · ${r.updated} updated · ${r.skipped_finalized} already finalized`, { type: "success", title: `Drafts for ${periodLabel(period)}` });
    await refresh(true);
  } catch (err) { errorToast(err); }
  genBtn.disabled = false;
  genBtn.replaceChildren(...label);
}
genBtn.addEventListener("click", generate);

exportBtn.addEventListener("click", () => {
  if (!invoices.length) return toast("Nothing to export for this month", { type: "info" });
  const esc = (v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const lines = ["number,tenant_id,tenant,period,plan,status,total_inr,finalized_at,paid_at"];
  for (const i of invoices) lines.push([i.number || "", i.tenant_id, i.tenant_name, i.period, i.plan_id, i.status, (i.total_paise / 100).toFixed(2), i.finalized_at || "", i.paid_at || ""].map(esc).join(","));
  downloadText(`invoices-${period}.csv`, lines.join("\n") + "\n");
  toast(`Exported ${invoices.length} invoices`, { type: "success" });
});

try {
  await load(box, () => refresh(true), { rows: 8 });
} catch (e) { /* error state shown */ }
