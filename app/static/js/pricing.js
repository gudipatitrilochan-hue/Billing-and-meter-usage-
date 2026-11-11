// Pure pricing functions — a line-for-line mirror of app/pricing.py (PRD Section 10).
// All money is integer paise. Rounding: (units * price_per_1000 + 500) // 1000, per line.

const intFmt = new Intl.NumberFormat("en-US");

export function tierLabel(t) {
  return t.to == null ? `${intFmt.format(t.from)}+` : `${intFmt.format(t.from)} to ${intFmt.format(t.to)}`;
}

/** @returns {{tier:string, units:number, per_1000:number, amount:number}[]} */
export function priceTiers(units, tiers) {
  const sorted = [...tiers].sort((a, b) => a.from - b.from);
  const lines = [];
  let remaining = units;
  for (const t of sorted) {
    if (remaining <= 0) break;
    const size = t.to == null ? remaining : t.to - t.from + 1;
    const inTier = Math.min(remaining, size);
    const amount = Math.floor((inTier * t.per_1000 + 500) / 1000);
    lines.push({ tier: tierLabel(t), units: inTier, per_1000: t.per_1000, amount });
    remaining -= inTier;
  }
  return lines;
}

export function buildInvoice(plan, usage) {
  const lines = [];
  for (const meter of Object.keys(usage)) {
    const tiers = plan.tiers[meter];
    if (!tiers) continue;
    for (const l of priceTiers(usage[meter] || 0, tiers)) lines.push({ ...l, meter });
  }
  const total = plan.base_fee_paise + lines.reduce((s, l) => s + l.amount, 0);
  return { base_fee: plan.base_fee_paise, lines, total };
}

/** Units included free for a meter (first tier priced 0), or 0 if none. */
export function freeAllowance(tiers) {
  if (!tiers || !tiers.length) return 0;
  const first = [...tiers].sort((a, b) => a.from - b.from)[0];
  return first.per_1000 === 0 && first.to != null ? first.to : 0;
}

/** Validate tiers per PRD rule 11. Returns null or {row, message}. */
export function validateTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return { row: 0, message: "At least one tier is required" };
  let expectedFrom = 1;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const last = i === tiers.length - 1;
    if (!Number.isInteger(t.from) || t.from !== expectedFrom)
      return { row: i, message: `Tier ${i + 1} must start at ${intFmt.format(expectedFrom)} (no gaps or overlaps)` };
    if (!Number.isInteger(t.per_1000) || t.per_1000 < 0)
      return { row: i, message: `Tier ${i + 1} price must be a whole number of paise ≥ 0` };
    if (last) {
      if (t.to != null) return { row: i, message: `Tier ${i + 1} is the last tier, so it must be open-ended` };
    } else {
      if (t.to == null) return { row: i, message: `Only the last tier can be open-ended (tier ${i + 1})` };
      if (!Number.isInteger(t.to) || t.to < t.from)
        return { row: i, message: `Tier ${i + 1} must end at or after ${intFmt.format(t.from)}` };
      expectedFrom = t.to + 1;
    }
  }
  return null;
}

// ---------- Money formatting (UI only) ----------

/** 306500 -> "₹3,065.00" */
export function formatINR(paise) {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const p = String(abs % 100).padStart(2, "0");
  return `${neg ? "−" : ""}₹${intFmt.format(rupees)}.${p}`;
}

/** Rate per 1,000 in paise -> "₹20 / 1,000" (drops .00) */
export function formatRate(per1000) {
  const s = formatINR(per1000);
  return `${s.endsWith(".00") ? s.slice(0, -3) : s} / 1,000`;
}

/** "499.5" | "499" | "₹1,999.00" -> paise integer, using string math (no floats). */
export function rupeesToPaise(input) {
  const s = String(input).replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [r, f = ""] = s.split(".");
  return parseInt(r, 10) * 100 + parseInt((f + "00").slice(0, 2), 10);
}

export const formatInt = (n) => intFmt.format(n);
