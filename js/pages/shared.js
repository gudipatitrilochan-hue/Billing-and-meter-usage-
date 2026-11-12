// Pieces shared by tenant detail, portal and invoice pages.
import { el, icon } from "../ui.js";
import { reduced } from "../motion.js";
import { formatINR, formatInt, formatRate, freeAllowance, tierLabel } from "../pricing.js";
import { METERS, ITEM_METERS } from "../config.js";

const gsap = window.gsap;
const meterName = (id) => ([...METERS, ...ITEM_METERS].find((m) => m.id === id) || { name: id }).name;
const item = (id) => ITEM_METERS.find((m) => m.id === id);
export const meterIcon = (id) => (item(id) ? item(id).icon : id === "api_calls" ? "code" : "mail");
/** "₹20 / 1,000" for metered usage, "₹20 / PDF" for per-item meters. */
export const rateFor = (meterId, per1000) => (item(meterId) ? `${formatINR(per1000 / 1000).replace(".00", "")} / ${item(meterId).unit}` : formatRate(per1000));

/**
 * Free-tier progress bar for one meter. Pushes an 80% alert banner into `banners` when due.
 * @param {"admin"|"tenant"} voice
 */
export function renderMeterBars(meterId, used, plan, banners = [], voice = "admin", tenantName = "This tenant") {
  const tiers = plan.tiers[meterId] || [];
  const allowance = freeAllowance(tiers);
  const current = [...tiers].sort((a, b) => a.from - b.from).find((t) => used >= t.from && (t.to == null || used <= t.to)) || tiers[0];
  if (!allowance) {
    return el("p", { class: "ml-hint mb-0" }, "No free tier on this meter — billed from the first unit at ", el("strong", { text: formatRate(tiers[0]?.per_1000 || 0) }), ".");
  }
  const pct = (used / allowance) * 100;
  const bar = el("div", { class: "ml-progress__bar" });
  const wrap = el("div", { class: `ml-progress ${pct > 100 ? "is-over" : pct >= 80 ? "is-warn" : ""}`, role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(allowance), "aria-valuenow": String(Math.min(used, allowance)), "aria-label": `${meterName(meterId)} free tier used` }, bar);
  requestAnimationFrame(() => {
    const w = Math.min(100, pct) + "%";
    if (gsap && !reduced) gsap.to(bar, { width: w, duration: 1.4, ease: "expo.out", delay: 0.2 });
    else bar.style.width = w;
  });
  if (pct >= 80) {
    const who = voice === "tenant" ? "You have" : `${tenantName} has`;
    const noun = meterId === "api_calls" ? "API calls" : "emails";
    banners.push(el("div", { class: "ml-banner", role: "status" }, icon("alert", 18),
      el("div", {}, el("strong", { text: pct > 100 ? `${who} used up the free ${noun}. ` : `${who} used ${Math.floor(pct)}% of the free ${noun}. ` }),
        pct > 100 ? `Extra units are billed at ${formatRate(current?.per_1000 || 0)} (${tierLabel(current)}).` : `${formatInt(allowance - used)} free units left this month.`)));
  }
  return el("div", { class: "ml-meterrow" },
    el("div", { class: "ml-meterrow__top" }, el("span", {}, "Free tier"), el("span", {}, el("strong", { text: formatInt(Math.min(used, allowance)) }), ` / ${formatInt(allowance)}`)),
    wrap,
    el("div", { class: "ml-hint mt-0" }, pct > 100 ? `Now in tier ${tierLabel(current)} at ${formatRate(current.per_1000)}` : `${Math.floor(pct)}% used`));
}

/** Invoice / estimate line table: base fee row + one row per tier (PRD S7). */
export function renderLines({ lines, base_fee_paise }) {
  const rows = [
    el("tr", {}, el("td", { "data-label": "Item" }, el("strong", { text: "Base fee" })), el("td", { "data-label": "Tier", class: "ml-muted", text: "—" }), el("td", { class: "r ml-num ml-muted", "data-label": "Units", text: "—" }), el("td", { class: "r ml-muted", "data-label": "Rate", text: "—" }), el("td", { class: "r ml-num", "data-label": "Amount", text: formatINR(base_fee_paise) })),
    ...lines.map((l) => el("tr", {},
      el("td", { "data-label": "Item" }, el("span", { class: "ml-meter-tag" }, icon(meterIcon(l.meter_id), 14), meterName(l.meter_id))),
      el("td", { "data-label": "Tier", text: l.tier_label }),
      el("td", { class: "r ml-num", "data-label": "Units", text: formatInt(l.units) }),
      el("td", { class: "r ml-num", "data-label": "Rate", text: rateFor(l.meter_id, l.price_per_1000_paise) }),
      el("td", { class: "r ml-num", "data-label": "Amount" }, el("strong", { text: formatINR(l.amount_paise) })))),
  ];
  if (!lines.length) rows.push(el("tr", {}, el("td", { colspan: "5", class: "ml-muted", "data-label": "", text: "No usage in this period — base fee only." })));
  return el("div", { class: "ml-tablewrap" }, el("table", { class: "ml-table ml-table--cards ml-lines" },
    el("caption", { class: "visually-hidden", text: "Invoice lines" }),
    el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Item" }), el("th", { scope: "col", text: "Tier" }), el("th", { scope: "col", class: "r", text: "Units" }), el("th", { scope: "col", class: "r", text: "Rate" }), el("th", { scope: "col", class: "r", text: "Amount" }))),
    el("tbody", {}, ...rows)));
}
