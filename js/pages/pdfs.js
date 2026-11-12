// PDF links — upload a PDF, get a link to share; each PDF adds ₹20 to this month's bill.
// The upload is one usage event on the pdf_links meter, so the charge shows on the estimate
// and the invoice like any other line. A retry with the same Idempotency-Key is never charged twice.
import { requireRole } from "../auth.js";
import { api, uploadPdf, ApiError } from "../api.js";
import { mountShell, el, qs, icon, load, toast, errorToast, emptyState, periodLabel, currentPeriod, copyText } from "../ui.js";
import { countUp, reveal, splitWords, pop, shake } from "../motion.js";
import { CONFIG } from "../config.js";
import { formatINR, formatInt } from "../pricing.js";

requireRole(["tenant"]);
mountShell({ page: "pdfs" });
const period = currentPeriod();
const MAX = 10 * 1024 * 1024;
const fileInput = qs("#f-file");
const drop = qs("#f-drop");
const submit = qs("#f-submit");
let chosen = null;
let pendingKey = null;   // reused if the same upload is retried after a network error

qs("#f-period").textContent = `PDF links · ${periodLabel(period)}`;
splitWords(qs("#f-title"), 0.15);

const newKey = () => "up-" + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
const sizeText = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const when = (iso) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function refreshSummary() {
  const est = await api("/usage/estimate", { query: { period } });
  const pdfLine = est.lines.filter((l) => l.meter_id === "pdf_links");
  const count = pdfLine.reduce((s, l) => s + l.units, 0);
  const charges = pdfLine.reduce((s, l) => s + l.amount_paise, 0);
  countUp(qs("#f-charges"), charges, formatINR, { duration: 1.2 });
  countUp(qs("#f-count"), count, formatInt, { duration: 1 });
  qs("#f-total").textContent = formatINR(est.total_paise);
  qs("#f-plan").textContent = `${est.plan_name} plan, ${periodLabel(period)}`;
  qs("#f-sub").textContent = count
    ? `${formatInt(count)} PDF${count === 1 ? "" : "s"} this month × ₹20 = ${formatINR(charges)}, already on your ${periodLabel(period)} bill.`
    : "Each PDF you upload costs ₹20 and is added to this month's bill.";
}

function linkActions(link) {
  return el("div", { class: "d-flex gap-2 flex-wrap" },
    el("button", { class: "btn ml-btn ml-btn--ghost ml-btn--sm", type: "button", onclick: () => copyText(link, "Link copied") }, icon("copy", 14), "Copy link"),
    el("a", { class: "btn ml-btn ml-btn--ghost ml-btn--sm", href: link, target: "_blank", rel: "noopener" }, icon("link", 14), "Open"));
}

async function loadList(box) {
  const rows = await api("/pdfs");
  qs("#f-list-sub").textContent = rows.length ? `${formatInt(rows.length)} link${rows.length === 1 ? "" : "s"}, newest first. Each was ₹20 in the month it was uploaded.` : "Newest first.";
  if (!rows.length) {
    box.replaceChildren(emptyState({ title: "No PDF links yet", body: "Upload your first PDF above. You'll get a link you can share right away." }));
    return;
  }
  const trs = rows.map((r) => el("tr", {},
    el("td", { "data-label": "File" }, el("span", { class: "ml-filecell" }, icon("file", 16), el("strong", { text: r.filename }))),
    el("td", { class: "r ml-num", "data-label": "Size", text: sizeText(r.size_bytes) }),
    el("td", { "data-label": "Uploaded", text: when(r.created_at) }),
    el("td", { class: "r ml-num", "data-label": "Charge", text: "₹20.00" }),
    el("td", { class: "r", "data-label": "Link" }, linkActions(r.link))));
  box.replaceChildren(el("div", { class: "ml-tablewrap" }, el("table", { class: "ml-table ml-table--cards" },
    el("caption", { class: "visually-hidden", text: "My PDF links" }),
    el("thead", {}, el("tr", {}, ...["File", "Size", "Uploaded", "Charge", "Link"].map((h, i) => el("th", { scope: "col", class: i === 1 || i >= 3 ? "r" : "", text: h })))),
    el("tbody", {}, ...trs))));
  reveal(trs, { stagger: 0.04 });
}

function choose(file) {
  qs("#f-result").replaceChildren();
  if (!file) return reset();
  const problem = !/\.pdf$/i.test(file.name) && file.type !== "application/pdf" ? "That isn't a PDF. Choose a .pdf file."
    : file.size > MAX ? `That file is ${sizeText(file.size)}. The limit is 10 MB.`
    : !file.size ? "That file is empty." : null;
  if (problem) { reset(); toast(problem, { type: "error" }); shake(drop); return; }
  chosen = file;
  pendingKey = newKey();
  drop.classList.add("has-file");
  qs("#f-drop-title").textContent = file.name;
  qs("#f-drop-meta").textContent = `${sizeText(file.size)} · ready to upload`;
  submit.disabled = false;
  qs("#f-clear").hidden = false;
  pop(drop);
}

function reset() {
  chosen = null;
  pendingKey = null;
  fileInput.value = "";
  drop.classList.remove("has-file");
  qs("#f-drop-title").innerHTML = "Drop a PDF here or <u>choose a file</u>";
  qs("#f-drop-meta").textContent = "₹20 will be added to your bill when you upload";
  submit.disabled = true;
  qs("#f-clear").hidden = true;
}

fileInput.addEventListener("change", () => choose(fileInput.files[0]));
qs("#f-clear").addEventListener("click", () => { reset(); fileInput.click(); });
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-over"); }));
drop.addEventListener("drop", (e) => choose(e.dataTransfer.files[0]));

qs("#f-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!chosen) return;
  const label = submit.textContent;
  submit.disabled = true;
  submit.textContent = "Uploading…";
  try {
    const res = await uploadPdf(chosen, pendingKey);
    const charged = res.status === "duplicate" ? "Already uploaded: same link, not charged again." : `${formatINR(res.charged_paise)} added to your ${periodLabel(res.period)} bill.`;
    const out = el("div", { class: "ml-linkout" },
      el("div", { class: "d-flex align-items-center gap-2" }, icon("check", 18), el("strong", { text: `Link ready for ${res.filename}` })),
      el("div", { class: "ml-linkout__row" }, el("code", { text: res.link }), linkActions(res.link)),
      el("small", { class: "ml-muted", text: charged + (CONFIG.API_MODE === "mock" ? " (Mock API: this link works in this browser until you reload.)" : "") }));
    qs("#f-result").replaceChildren(out);
    pop(out);
    toast(charged, { type: "success", title: "PDF link created" });
    reset();
    await Promise.all([refreshSummary(), loadList(qs("#f-list"))]);
  } catch (err) {
    submit.disabled = false;
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) pendingKey = newKey(); // rejected, not lost
    errorToast(err);
  } finally {
    submit.textContent = label;
    if (!chosen) submit.disabled = true;
  }
});

const base = location.origin + (CONFIG.API_MODE === "mock" ? "/api" : CONFIG.API_BASE);
qs("#f-curl").textContent = `curl -X POST ${base}/pdfs \\\n  -H "X-Api-Key: $METERLEDGER_KEY" \\\n  -H "Idempotency-Key: invoice-0042" \\\n  -F "file=@report.pdf"`;

try {
  await refreshSummary();
} catch (err) {
  if (err.status !== 401) errorToast(err, () => location.reload());
}
load(qs("#f-list"), () => loadList(qs("#f-list")), { rows: 3 }).catch(() => {});
