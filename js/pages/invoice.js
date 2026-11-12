// S7 Invoice detail — printable layout, line items, totals, status, timeline, lifecycle actions.
import { requireRole } from "../auth.js";
import { api } from "../api.js";
import { mountShell, el, qs, icon, statusPill, periodLabel, toast, errorToast, errorState, skeleton, confirmModal, param } from "../ui.js";
import { countUp, reveal, pop, confetti, enhance, reduced } from "../motion.js";
import { renderLines } from "./shared.js";
import { formatINR } from "../pricing.js";

const gsap = window.gsap;
const session = requireRole(["admin", "tenant"]);
const isAdmin = session.role === "admin";
const id = param("id");
const printBtn = el("button", { class: "btn ml-btn ml-btn--ghost", type: "button", onclick: () => window.print() }, icon("printer", 16), "Print");
mountShell({ page: isAdmin ? "invoices" : "portal", title: "Invoice", subtitle: " ", actions: [printBtn] });
qs(".ml-pagehead").before(el("a", { class: "ml-crumb", href: isAdmin ? "invoices.html" : "portal.html#invoices" }, icon("back", 15), isAdmin ? "All invoices" : "My invoices"));

const fmtDate = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
let inv = null;

async function loadInvoice() {
  inv = await api(`/invoices/${encodeURIComponent(id || "")}`);
  render(true);
}

function render(first = false) {
  document.title = `${inv.number || "Draft invoice"} · MeterLedger`;
  qs(".ml-h1").textContent = inv.number || "Draft invoice";
  qs(".ml-pagehead__sub").textContent = `${inv.tenant_name} · ${periodLabel(inv.period)}`;
  const amount = el("strong", { class: "ml-num", text: formatINR(first ? 0 : inv.total_paise) });
  const usedLines = inv.lines.reduce((s, l) => s + l.amount_paise, 0);
  const sheet = el("article", { class: "ml-invoice__sheet", "aria-label": "Invoice" },
    el("header", { class: "ml-panel ml-invoice__head" },
      el("div", {},
        el("span", { class: "ml-logo" }, el("span", { class: "ml-logo__mark", "aria-hidden": "true" }, el("i"), el("i"), el("i")), el("span", { class: "ml-logo__word" }, "Meter", el("b", {}, "Ledger"))),
        el("div", { class: "ml-invoice__no", text: inv.number || "DRAFT — number assigned on finalize" })),
      el("div", { class: "ml-invoice__amount" }, el("span", { class: "ml-muted", text: inv.status === "paid" ? "Amount paid" : "Amount due" }), amount, el("div", { class: "mt-2" }, statusPill(inv.status)))),
    el("dl", { class: "ml-invoice__meta" },
      el("div", {}, el("dt", { text: "Billed to" }), el("dd", { text: inv.tenant_name })),
      el("div", {}, el("dt", { text: "Period" }), el("dd", { text: periodLabel(inv.period) })),
      el("div", {}, el("dt", { text: "Plan" }), el("dd", { text: inv.plan_name })),
      el("div", {}, el("dt", { text: "Currency" }), el("dd", { text: "INR · no tax" }))),
    el("div", { class: "ml-invoice__body" }, renderLines(inv)),
    el("div", { class: "ml-invoice__total" },
      el("div", {}, el("span", { text: "Base fee" }), el("strong", { class: "ml-num", text: formatINR(inv.base_fee_paise) })),
      el("div", {}, el("span", { text: "Usage" }), el("strong", { class: "ml-num", text: formatINR(usedLines) })),
      el("div", {}, el("span", { text: "Total" }), el("strong", { class: "ml-num", text: formatINR(inv.total_paise) }))));

  const side = el("aside", { class: "ml-invoice__side" }, actionsCard(), timelineCard());
  qs("#invoice").replaceChildren(el("div", { class: "ml-split" }, el("div", { class: "ml-invoice" }, sheet), side));
  enhance(qs("#invoice"));
  if (first) {
    countUp(amount, inv.total_paise, formatINR, { from: 0, duration: 1.4, delay: 0.2 });
    reveal([sheet, ...side.children], { stagger: 0.1 });
    reveal(sheet.querySelectorAll("tbody tr"), { stagger: 0.05, delay: 0.3, y: 8 });
  }
  if (isAdmin && inv.status === "draft") checkStale();
  animateTimeline();
}

function actionsCard() {
  const card = el("section", { class: "ml-card ml-noprint" }, el("h2", { class: "ml-h3 mb-2", text: "Actions" }));
  const explain = {
    draft: "Drafts can be regenerated any time. Finalizing locks the lines, assigns a number and closes the period for new events.",
    finalized: "Locked and numbered. Mark it paid when the money arrives, or void it to cancel.",
    paid: "Paid — this invoice can no longer change.",
    void: `Voided${inv.void_reason ? `: “${inv.void_reason}”` : ""}. Generate a new draft for this period from the Invoices page.`,
  }[inv.status];
  card.append(el("p", { class: "ml-hint mb-3", text: explain }));
  if (!isAdmin) {
    card.append(el("p", { class: "ml-hint mb-0", text: "Questions about this bill? Each line shows the tier, units and rate so you can check it yourself." }));
    return card;
  }
  const row = el("div", { class: "d-flex gap-2 flex-wrap", id: "stale-slot" });
  const b = (label, cls, action) => el("button", { class: `btn ml-btn ${cls}`, type: "button", "data-magnetic": "0.15", onclick: (e) => act(action, e) }, label);
  if (inv.status === "draft") row.append(b("Finalize invoice", "ml-btn--ink", "finalize"));
  if (inv.status === "finalized") row.append(b("Mark paid (mock)", "ml-btn--accent", "pay"), b("Void", "ml-btn--ghost", "void"));
  card.append(row);
  return card;
}

function timelineCard() {
  const steps = [
    { label: "Drafted", at: inv.created_at, done: true },
    { label: "Finalized", at: inv.finalized_at, done: !!inv.finalized_at },
    inv.status === "void" ? { label: "Voided", at: inv.voided_at, done: true, void: true } : { label: "Paid", at: inv.paid_at, done: !!inv.paid_at },
  ];
  const fill = el("span", { class: "ml-timeline__fill", "aria-hidden": "true" });
  const list = el("ol", { class: "ml-timeline" }, fill, ...steps.map((s) => el("li", { class: `${s.done ? "is-done" : ""} ${s.void ? "is-void" : ""}` },
    el("span", { class: "ml-timeline__dot", "aria-hidden": "true" }), el("strong", { text: s.label }), el("span", { text: s.at ? fmtDate(s.at) : "Pending" }))));
  return el("section", { class: "ml-card" }, el("h2", { class: "ml-h3 mb-3", text: "Timeline" }), list);
}

function animateTimeline() {
  const list = qs(".ml-timeline");
  if (!list) return;
  const done = [...list.querySelectorAll("li.is-done")];
  const last = done[done.length - 1];
  const h = last ? last.offsetTop + 8 : 0;
  const fill = qs(".ml-timeline__fill", list);
  if (gsap && !reduced) gsap.fromTo(fill, { height: 0 }, { height: h, duration: 1, ease: "expo.out", delay: 0.4 });
  else fill.style.height = h + "px";
}

async function checkStale() {
  try {
    const est = await api("/usage/estimate", { query: { period: inv.period, tenant_id: inv.tenant_id } });
    if (est.total_paise !== inv.total_paise) {
      const slot = qs("#stale-slot");
      slot.before(el("div", { class: "ml-banner" }, icon("alert", 18), el("div", {}, el("strong", { text: "Usage changed since this draft. " }), `Live estimate is ${formatINR(est.total_paise)}. Regenerate before finalizing.`)));
      slot.append(el("button", { class: "btn ml-btn ml-btn--ghost", type: "button", onclick: regenerate }, icon("refresh", 15), "Regenerate draft"));
    }
  } catch (e) { /* non-critical */ }
}

async function regenerate() {
  try {
    await api("/invoices/generate", { method: "POST", body: { period: inv.period, tenant_id: inv.tenant_id } });
    toast("Draft regenerated from current usage", { type: "success" });
    await loadInvoice();
  } catch (e) { errorToast(e); }
}

async function act(action, e) {
  let body;
  if (action === "void") {
    const reason = await confirmModal({ title: `Void ${inv.number}?`, message: "This cancels the invoice. Finalized invoices are never deleted; void is the only way to cancel one.", confirmLabel: "Void invoice", danger: true, input: { label: "Reason", placeholder: "e.g. wrong plan applied" } });
    if (!reason) return;
    body = { reason };
  }
  if (action === "pay") body = { method: "mock" };
  const x = e.clientX, y = e.clientY;
  try {
    inv = await api(`/invoices/${inv.id}/${action}`, { method: "POST", body });
    render(false);
    pop(qs(".ml-invoice__amount .ml-status"));
    if (action === "pay") { confetti(x, y, 48); toast(`${inv.number} marked paid`, { type: "success" }); }
    else if (action === "finalize") toast(`Finalized as ${inv.number}`, { type: "success" });
    else toast(`${inv.number} voided`, { type: "info" });
  } catch (err) { errorToast(err); }
}

try {
  qs("#invoice").replaceChildren(skeleton(8));
  await loadInvoice();
} catch (e) {
  qs("#invoice").replaceChildren(errorState(e, () => location.reload()));
}
