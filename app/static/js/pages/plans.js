// S5 Plans & pricing — plan cards with tier tables, a live price calculator with an
// animated tier waterfall, and (admin) a create-plan form with add-tier rows.
import { requireRole, getSession } from "../auth.js";
import { api } from "../api.js";
import { mountShell, el, qs, icon, load, toast, errorToast, emptyState } from "../ui.js";
import { reveal, enhance, countUp, splitWords, pop, reduced } from "../motion.js";
import { METERS, ITEM_METERS } from "../config.js";
import { rateFor } from "./shared.js";
import { buildInvoice, formatINR, formatInt, formatRate, tierLabel, validateTiers, rupeesToPaise } from "../pricing.js";

const gsap = window.gsap;
const session = requireRole(["admin", "tenant", "public"]);
const isAdmin = session && session.role === "admin";
mountShell({
  page: "plans",
  title: isAdmin ? "Plans & pricing" : session ? "Price list" : null,
  subtitle: isAdmin ? "Plan versions, tier tables and a calculator to sanity-check any bill." : session ? "What each plan costs, tier by tier." : null,
});
splitWords(qs("#pricing-title"), 0.2);

let plans = [];
const grid = qs("#plan-grid");

async function fetchPlans() {
  plans = await api("/plans");
  renderCards();
  renderCalc();
  if (isAdmin) renderCreate();
}

// ---------- plan cards ----------
function renderCards() {
  if (!plans.length) { grid.replaceChildren(emptyState({ title: "No plans yet" })); return; }
  const mine = session && session.role === "tenant" ? session.tenant.plan_id : null;
  const cards = plans.map((p) => {
    const featured = mine ? p.id === mine : p.id === "starter";
    const fee = p.base_fee_paise;
    const card = el("article", { class: `ml-price ${featured ? "ml-price--featured" : ""}`, "data-tilt": "5", "aria-label": `${p.name} plan` },
      el("div", { class: "ml-price__name" }, el("span", { text: p.name }),
        mine === p.id ? el("span", { class: "ml-eyebrow ml-eyebrow--dark" }, el("i"), "Your plan")
          : featured ? el("span", { class: "ml-eyebrow ml-eyebrow--dark" }, el("i"), "Popular")
          : p.locked && isAdmin ? el("span", { class: "ml-lock", title: "Used on a finalized invoice — create a new version to change it" }, "Locked") : null),
      el("div", { class: "ml-price__fee" }, fee ? formatINR(fee).replace(".00", "") : "₹0", el("small", { text: " / month base" })),
      ...METERS.map((m) => el("div", {},
        el("div", { class: "ml-price__meter" }, icon(m.id === "api_calls" ? "code" : "mail", 13), m.name),
        el("ul", { class: "ml-price__tiers" }, ...p.tiers[m.id].map((t) => el("li", { class: t.per_1000 === 0 ? "is-free" : "" },
          el("span", { text: tierLabel(t) }), el("span", { text: t.per_1000 === 0 ? "Free" : formatRate(t.per_1000) })))))),
      ...ITEM_METERS.filter((m) => p.tiers[m.id]).map((m) => el("div", {},
        el("div", { class: "ml-price__meter" }, icon(m.icon, 13), m.name),
        el("ul", { class: "ml-price__tiers" }, el("li", {}, el("span", { text: `Each ${m.unit}` }), el("span", { text: rateFor(m.id, p.tiers[m.id][0].per_1000) }))))),
      el("div", { class: "ml-price__foot" },
        el("button", { class: `btn ml-btn ml-btn--sm ${featured ? "ml-btn--onpanel" : "ml-btn--panelghost"}`, type: "button", onclick: () => pickInCalc(p.id) }, "Price a month", icon("arrow", 14)),
        isAdmin ? el("button", { class: "btn ml-btn ml-btn--sm ml-btn--panelghost", type: "button", onclick: () => duplicate(p) }, icon("copy", 14), "New version") : null));
    return card;
  });
  grid.replaceChildren(...cards);
  if (gsap && !reduced) gsap.from(cards, { y: 50, opacity: 0, rotationX: -12, duration: 0.9, stagger: 0.1, ease: "expo.out", delay: 0.2, clearProps: "opacity" });
  enhance(grid);
}

// ---------- calculator ----------
let calc = { plan: "starter", api_calls: 135400, emails_sent: 2350 };

function renderCalc() {
  if (!plans.find((p) => p.id === calc.plan)) calc.plan = plans[0].id;
  if (session && session.role === "tenant") calc.plan = session.tenant.plan_id;
  const box = qs("#calc");
  const sel = el("select", { class: "form-select ml-input", id: "calc-plan" }, ...plans.map((p) => el("option", { value: p.id, text: p.name })));
  sel.value = calc.plan;
  const calls = el("input", { class: "form-control ml-input ml-num", id: "calc-calls", inputmode: "numeric", value: formatInt(calc.api_calls) });
  const emails = el("input", { class: "form-control ml-input ml-num", id: "calc-emails", inputmode: "numeric", value: formatInt(calc.emails_sent) });
  const out = el("div", { id: "calc-out", "aria-live": "polite" });
  box.replaceChildren(
    el("div", { class: "ml-card__head" }, el("div", {}, el("h2", { class: "ml-h2", text: "Price calculator" }), el("p", { class: "ml-card__sub", text: `“What would ${formatInt(135400)} calls cost on Starter?” Units fill tier 1 first, then tier 2…` }))),
    el("div", { class: "ml-grid-3 mb-3" },
      el("div", {}, el("label", { class: "ml-label", for: "calc-plan", text: "Plan" }), sel),
      el("div", {}, el("label", { class: "ml-label", for: "calc-calls", text: "API calls" }), calls),
      el("div", {}, el("label", { class: "ml-label", for: "calc-emails", text: "Emails sent" }), emails)),
    out);
  const parse = (v) => {
    const n = parseInt(String(v).replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) ? Math.min(n, 1e9) : 0;
  };
  let t;
  const onInput = (e) => {
    calc = { plan: sel.value, api_calls: parse(calls.value), emails_sent: parse(emails.value) };
    if (e && e.target !== sel) {
      const inp = e.target;
      const n = parse(inp.value);
      inp.value = inp.value.trim() === "" ? "" : formatInt(n);
    }
    clearTimeout(t);
    t = setTimeout(computeCalc, 80);
  };
  sel.addEventListener("change", onInput);
  calls.addEventListener("input", onInput);
  emails.addEventListener("input", onInput);
  computeCalc();
}

let lastTotal = 0;
function computeCalc() {
  const plan = plans.find((p) => p.id === calc.plan);
  const inv = buildInvoice(plan, { api_calls: calc.api_calls, emails_sent: calc.emails_sent });
  const out = qs("#calc-out");
  const rows = [];
  for (const m of METERS) {
    const sorted = [...plan.tiers[m.id]].sort((a, b) => a.from - b.from);
    const lines = inv.lines.filter((l) => l.meter === m.id);
    sorted.forEach((tier, i) => {
      const line = lines[i];
      const units = line ? line.units : 0;
      const size = tier.to == null ? Math.max(units, 1) : tier.to - tier.from + 1;
      const fill = el("div", { class: "ml-water__fill" }, units ? `${formatInt(units)} × ${tier.per_1000 ? formatRate(tier.per_1000) : "free"}` : "");
      const amt = el("span", { class: "ml-water__amt", text: formatINR(line ? line.amount : 0) });
      const row = el("div", { class: `ml-water__row ${tier.per_1000 === 0 ? "is-free" : ""}` },
        el("span", {}, el("strong", { text: m.short }), " ", el("span", { class: "ml-muted", text: tierLabel(tier) })),
        el("div", { class: "ml-water__track", "aria-hidden": "true" }, fill), amt);
      rows.push({ row, fill, pct: Math.min(1, units / size), delay: rows.length * 0.08 });
    });
  }
  const total = el("strong", { class: "ml-num", text: formatINR(lastTotal) });
  out.replaceChildren(
    el("div", { class: "ml-water" },
      el("div", { class: "ml-water__row" }, el("span", {}, el("strong", { text: "Base fee" })), el("span", { class: "ml-muted", text: "fixed monthly" }), el("span", { class: "ml-water__amt", text: formatINR(inv.base_fee) })),
      ...rows.map((r) => r.row)),
    el("div", { class: "ml-calc__total" }, el("span", { class: "ml-muted", text: `Total on ${plan.name}` }), total));
  for (const r of rows) {
    if (gsap && !reduced) gsap.fromTo(r.fill, { width: "0%" }, { width: r.pct * 100 + "%", duration: 0.9, ease: "expo.out", delay: r.delay });
    else r.fill.style.width = r.pct * 100 + "%";
  }
  countUp(total, inv.total, formatINR, { from: lastTotal, duration: 0.8 });
  lastTotal = inv.total;
}

function pickInCalc(id) {
  calc.plan = id;
  const sel = qs("#calc-plan");
  sel.value = id;
  sel.dispatchEvent(new Event("change"));
  qs("#calc").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  if (gsap && !reduced) gsap.fromTo("#calc", { boxShadow: "0 0 0 0 rgba(134,239,172,0)" }, { boxShadow: "0 0 0 6px rgba(134,239,172,.45)", duration: 0.4, yoyo: true, repeat: 1, delay: 0.4, clearProps: "boxShadow" });
}

// ---------- create plan (admin) ----------
let draft = null;
function blankDraft() {
  return {
    id: "", name: "", fee: "0",
    tiers: { api_calls: [{ to: "10000", price: "0" }, { to: "", price: "20" }], emails_sent: [{ to: "", price: "100" }] },
  };
}

function duplicate(p) {
  const n = plans.filter((x) => x.id.startsWith(p.id)).length + 1;
  draft = {
    id: `${p.id}-v${n}`, name: `${p.name} v${n}`, fee: (p.base_fee_paise / 100).toFixed(2),
    tiers: Object.fromEntries(METERS.map((m) => [m.id, p.tiers[m.id].map((t) => ({ to: t.to == null ? "" : String(t.to), price: (t.per_1000 / 100).toString() }))])),
  };
  renderCreate();
  qs("#create").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  qs("#cp-id").focus();
}

function renderCreate() {
  const box = qs("#create");
  box.hidden = false;
  if (!draft) draft = blankDraft();
  const f = (id, label, input, hint) => el("div", { class: "ml-field" }, el("label", { class: "ml-label", for: id, text: label }), input, hint ? el("div", { class: "ml-hint", text: hint }) : null);
  const idIn = el("input", { class: "form-control ml-input ml-input--mono", id: "cp-id", value: draft.id, placeholder: "starter-v2", required: true });
  const nameIn = el("input", { class: "form-control ml-input", id: "cp-name", value: draft.name, placeholder: "Starter v2", required: true });
  const feeIn = el("input", { class: "form-control ml-input ml-num", id: "cp-fee", value: draft.fee, inputmode: "decimal" });
  idIn.addEventListener("input", () => (draft.id = idIn.value));
  nameIn.addEventListener("input", () => (draft.name = nameIn.value));
  feeIn.addEventListener("input", () => (draft.fee = feeIn.value));
  const err = el("div", { class: "ml-banner d-none", role: "alert" });
  const meterBlocks = METERS.map((m) => tierEditor(m));
  const submit = el("button", { class: "btn ml-btn ml-btn--ink", type: "submit" }, icon("plus", 16), "Create plan");
  const form = el("form", { novalidate: true },
    el("div", { class: "ml-grid-3" }, f("cp-id", "Plan id", idIn), f("cp-name", "Name", nameIn), f("cp-fee", "Base fee (₹ / month)", feeIn)),
    ...meterBlocks, err,
    el("div", { class: "d-flex gap-2 justify-content-end" },
      el("button", { class: "btn ml-btn ml-btn--ghost", type: "button", onclick: () => { draft = blankDraft(); renderCreate(); } }, "Clear"), submit));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.classList.add("d-none");
    const body = toBody();
    if (body.error) return showErr(body.error);
    submit.disabled = true;
    try {
      const created = await api("/plans", { method: "POST", body });
      toast(`Plan “${created.name}” created`, { type: "success" });
      draft = null;
      calc.plan = created.id;
      await fetchPlans();
      const card = [...grid.children].find((c) => c.getAttribute("aria-label") === `${created.name} plan`);
      if (card) pop(card);
    } catch (ex) {
      submit.disabled = false;
      showErr(ex.detail);
    }
  });
  function showErr(msg) {
    err.replaceChildren(icon("alert", 18), el("span", { text: msg }));
    err.classList.remove("d-none");
    if (gsap && !reduced) gsap.fromTo(err, { x: -6 }, { x: 0, duration: 0.4, ease: "elastic.out(1, 0.3)" });
  }
  box.replaceChildren(
    el("div", { class: "ml-card__head" }, el("div", {}, el("h2", { class: "ml-h2", text: "Create a plan" }), el("p", { class: "ml-card__sub", text: "Plans on a finalized invoice are locked; publish a new version instead. Tiers must start at 1 and be contiguous." }))),
    form);
}

function tierEditor(m) {
  const wrap = el("fieldset", { class: "mb-3" }, el("legend", { class: "ml-h3 mb-2 d-flex align-items-center gap-2" }, icon(m.id === "api_calls" ? "code" : "mail", 15), m.name));
  const rowsBox = el("div");
  const rows = draft.tiers[m.id];
  const paint = () => {
    let from = 1;
    rowsBox.replaceChildren(...rows.map((r, i) => {
      const last = i === rows.length - 1;
      const fromIn = el("input", { class: "form-control ml-input ml-num", value: formatInt(from), readonly: true, tabindex: "-1", "aria-label": `Tier ${i + 1} from` });
      const toIn = el("input", { class: "form-control ml-input ml-num", value: last ? "" : r.to, placeholder: last ? "No limit" : "e.g. 100000", disabled: last, inputmode: "numeric", "aria-label": `Tier ${i + 1} to` });
      const priceIn = el("input", { class: "form-control ml-input ml-num", value: r.price, inputmode: "decimal", "aria-label": `Tier ${i + 1} price in rupees per 1,000` });
      toIn.addEventListener("change", () => { r.to = toIn.value.replace(/[^\d]/g, ""); paint(); });
      priceIn.addEventListener("input", () => (r.price = priceIn.value));
      const rm = el("button", { class: "ml-iconbtn", type: "button", "aria-label": `Remove tier ${i + 1}`, disabled: rows.length === 1, onclick: () => { rows.splice(i, 1); paint(); } }, icon("close", 14));
      const toNum = parseInt(r.to, 10);
      from = Number.isFinite(toNum) ? toNum + 1 : from;
      return el("div", { class: "ml-tierrow" },
        el("div", {}, el("span", { class: "ml-label", text: i === 0 ? "From" : " " }), fromIn),
        el("div", {}, el("span", { class: "ml-label", text: i === 0 ? "To" : " " }), toIn),
        el("div", {}, el("span", { class: "ml-label", text: i === 0 ? "₹ per 1,000" : " " }), priceIn),
        rm);
    }));
  };
  paint();
  const add = el("button", { class: "btn ml-btn ml-btn--ghost ml-btn--sm", type: "button", onclick: () => {
    const last = rows[rows.length - 1];
    const prevTo = rows.length > 1 ? parseInt(rows[rows.length - 2].to, 10) || 0 : 0;
    last.to = String(prevTo + 10000);
    rows.push({ to: "", price: last.price });
    paint();
    const newRow = rowsBox.lastElementChild;
    if (gsap && !reduced) gsap.from(newRow, { height: 0, opacity: 0, y: -10, duration: 0.4 });
  } }, icon("plus", 14), "Add tier");
  wrap.append(rowsBox, add);
  return wrap;
}

function toBody() {
  const fee = rupeesToPaise(draft.fee || "0");
  if (fee == null) return { error: "Base fee must be a rupee amount like 499 or 499.50" };
  const tiers = {};
  for (const m of METERS) {
    let from = 1;
    const list = [];
    const rows = draft.tiers[m.id];
    for (let i = 0; i < rows.length; i++) {
      const last = i === rows.length - 1;
      const price = rupeesToPaise(rows[i].price || "0");
      if (price == null) return { error: `${m.name}: tier ${i + 1} price must be a rupee amount` };
      const to = last ? null : parseInt(rows[i].to, 10);
      list.push({ from, to: Number.isFinite(to) ? to : last ? null : NaN, per_1000: price });
      if (!last) from = (Number.isFinite(to) ? to : from) + 1;
    }
    const v = validateTiers(list.map((t) => ({ ...t, to: Number.isNaN(t.to) ? undefined : t.to })));
    if (v) return { error: `${m.name}: ${v.message}` };
    tiers[m.id] = list;
  }
  return { id: draft.id.trim(), name: draft.name.trim(), base_fee_paise: fee, tiers };
}

// ---------- boot ----------
if (!isAdmin) {
  qs("#create").remove();
  qs("#plans-split").classList.remove("ml-split");
}
if (!session) {
  qs("#public-cta").hidden = false;
}
try {
  await load(grid, fetchPlans, { rows: 3 });
} catch (e) { /* error state shown */ }
reveal(qsAll("#plans-split > section"), { delay: 0.3 });

function qsAll(s) { return [...document.querySelectorAll(s)]; }
