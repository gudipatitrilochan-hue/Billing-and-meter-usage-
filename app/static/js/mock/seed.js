// Deterministic demo data, mirroring what scripts/seed.py will create in the backend phase:
// 3 plans, 8 tenants, 3 months of events (two months ago, last month, this month to date).
// ShopKart's month from two months back equals PRD case C1 exactly (135,400 calls, 2,350 emails),
// and TinyBot's equals C2 (8,200 calls).

import { buildInvoice, tierLabel } from "../pricing.js";
import { CONFIG } from "../config.js";

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const periodOf = (ms) => new Date(ms).toISOString().slice(0, 7);
export function shiftPeriod(period, delta) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
export function periodStart(period) {
  const [y, m] = period.split("-").map(Number);
  return Date.UTC(y, m - 1, 1);
}
export function daysIn(period) {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const URLSAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export function tokenUrlSafe(nBytes, rnd = Math.random) {
  // token_urlsafe(24) -> 32 chars
  const len = Math.ceil((nBytes * 4) / 3);
  let s = "";
  if (rnd === Math.random && crypto.getRandomValues) {
    const arr = crypto.getRandomValues(new Uint8Array(len));
    for (const b of arr) s += URLSAFE[b & 63];
  } else {
    for (let i = 0; i < len; i++) s += URLSAFE[Math.floor(rnd() * 64)];
  }
  return s;
}

const PLANS = [
  {
    id: "free", name: "Free", base_fee_paise: 0,
    tiers: {
      api_calls: [{ from: 1, to: 10000, per_1000: 0 }, { from: 10001, to: null, per_1000: 2500 }],
      emails_sent: [{ from: 1, to: null, per_1000: 10000 }],
    },
  },
  {
    id: "starter", name: "Starter", base_fee_paise: 49900,
    tiers: {
      api_calls: [
        { from: 1, to: 10000, per_1000: 0 },
        { from: 10001, to: 100000, per_1000: 2000 },
        { from: 100001, to: null, per_1000: 1500 },
      ],
      emails_sent: [{ from: 1, to: null, per_1000: 10000 }],
    },
  },
  {
    id: "growth", name: "Growth", base_fee_paise: 199900,
    tiers: {
      api_calls: [
        { from: 1, to: 50000, per_1000: 0 },
        { from: 50001, to: 500000, per_1000: 1200 },
        { from: 500001, to: null, per_1000: 800 },
      ],
      emails_sent: [{ from: 1, to: 5000, per_1000: 0 }, { from: 5001, to: null, per_1000: 8000 }],
    },
  },
];

// [id, name, plan, eventPrefix, monthly api_calls, monthly emails]
const TENANTS = [
  ["t_shopkart", "ShopKart", "starter", "shk", 151200, 2900],
  ["t_tinybot", "TinyBot", "free", "tnb", 9600, 0],
  ["t_paynest", "PayNest", "growth", "pnt", 620000, 18400],
  ["t_quickcab", "QuickCab", "starter", "qcb", 64000, 900],
  ["t_mediminder", "MediMinder", "free", "mdm", 14500, 1200],
  ["t_lumenlabs", "Lumen Labs", "growth", "lml", 410000, 7600],
  ["t_chaiwala", "Chaiwala Co", "starter", "chw", 98500, 4100],
  ["t_farmlink", "FarmLink", "free", "fml", 3100, 300],
];

// Fixed month totals that must match the PRD worked cases.
const FIXED = {
  "t_shopkart|-2": { api_calls: 135400, emails_sent: 2350 },
  "t_tinybot|-2": { api_calls: 8200, emails_sent: 0 },
};

/** Split `total` into `parts` integers that sum exactly, weighted. */
function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) out[order[k][1]]++;
  return out;
}

export async function buildSeed(now = Date.now()) {
  const rnd = mulberry32(20260901);
  const current = periodOf(now);
  const months = [-2, -1, 0].map((d) => ({ delta: d, period: shiftPeriod(current, d) }));
  const created = periodStart(months[0].period) - 6 * 86400000;

  const plans = PLANS.map((p) => ({ ...p, currency: CONFIG.CURRENCY, active: 1, created_at: new Date(created).toISOString() }));
  const tenants = [];
  const demoKeys = {};
  for (const [id, name, plan_id] of TENANTS) {
    const raw = "ml_" + tokenUrlSafe(24, rnd);
    demoKeys[id] = raw;
    tenants.push({
      id, name, plan_id,
      api_key_hash: await sha256(raw),
      key_prefix: raw.slice(0, 8),
      key_last4: raw.slice(-4),
      status: "active",
      created_at: new Date(created + rnd() * 3 * 86400000).toISOString(),
    });
  }

  // events: [tenant_id, event_id, meter_id, quantity, occurred_ms, received_ms]
  const events = [];
  for (const [id, , , prefix, calls, emails] of TENANTS) {
    for (const { delta, period } of months) {
      const days = daysIn(period);
      const start = periodStart(period);
      const isCurrent = delta === 0;
      const lastDay = isCurrent ? new Date(now).getUTCDate() : days;
      const fixed = FIXED[`${id}|${delta}`];
      const growth = 1 + delta * 0.06 + (rnd() - 0.5) * 0.12;
      const progress = isCurrent ? (now - start) / (days * 86400000) : 1;
      const target = {
        api_calls: fixed ? fixed.api_calls : Math.round(calls * growth * progress),
        emails_sent: fixed ? fixed.emails_sent : Math.round(emails * growth * progress),
      };
      let seq = 0;
      for (const meter of ["api_calls", "emails_sent"]) {
        if (target[meter] <= 0) continue;
        const weights = [];
        for (let d = 1; d <= lastDay; d++) {
          const dow = new Date(start + (d - 1) * 86400000).getUTCDay();
          const weekday = dow === 0 || dow === 6 ? 0.62 : 1;
          const w = weekday * (0.75 + rnd() * 0.5);
          // today only partially elapsed
          weights.push(isCurrent && d === lastDay ? w * (((now - start) / 86400000) % 1 || 0.05) : w);
        }
        const daily = allocate(target[meter], weights);
        daily.forEach((qty, i) => {
          if (qty <= 0) return;
          const dayStart = start + i * 86400000;
          const dayEnd = isCurrent && i === lastDay - 1 ? now - 60000 : dayStart + 86400000 - 1000;
          const pieces = Math.max(1, Math.min(4, Math.ceil(qty / 900)) + Math.floor(rnd() * 2));
          const split = allocate(qty, Array.from({ length: pieces }, () => 0.4 + rnd()));
          const times = split.map(() => dayStart + rnd() * Math.max(1000, dayEnd - dayStart)).sort((a, b) => a - b);
          split.forEach((q, k) => {
            if (q <= 0) return;
            seq++;
            const day = new Date(dayStart).toISOString().slice(0, 10);
            const occurred = Math.floor(times[k]);
            events.push([id, `${prefix}-${day}-${String(seq).padStart(4, "0")}`, meter, q, occurred, occurred + 200 + Math.floor(rnd() * 1800)]);
          });
        });
      }
    }
  }
  events.sort((a, b) => a[5] - b[5]);

  // Invoices for the two closed months.
  const invoices = [];
  const numbers = {};
  let invoiceId = 0;
  for (const { delta, period } of months.slice(0, 2)) {
    const genAt = periodStart(shiftPeriod(period, 1)) + 3600000 * 3;
    const order = tenants.map((t) => t.id);
    for (const t of tenants) {
      const plan = plans.find((p) => p.id === t.plan_id);
      const usage = { api_calls: 0, emails_sent: 0 };
      for (const e of events) if (e[0] === t.id && periodOf(e[4]) === period) usage[e[2]] += e[3];
      const inv = buildInvoice(plan, usage);
      const key = period.replace("-", "");
      numbers[key] = (numbers[key] || 0) + 1;
      const finalizedAt = genAt + 86400000 + order.indexOf(t.id) * 600000;
      const unpaid = delta === -1 && ["t_quickcab", "t_lumenlabs", "t_chaiwala"].includes(t.id);
      invoices.push({
        id: ++invoiceId,
        number: `INV-${key}-${String(numbers[key]).padStart(4, "0")}`,
        tenant_id: t.id,
        period,
        plan_id: plan.id,
        plan_name: plan.name,
        status: unpaid ? "finalized" : "paid",
        base_fee_paise: inv.base_fee,
        total_paise: inv.total,
        created_at: new Date(genAt).toISOString(),
        finalized_at: new Date(finalizedAt).toISOString(),
        paid_at: unpaid ? null : new Date(finalizedAt + (2 + rnd() * 6) * 86400000).toISOString(),
        voided_at: null,
        void_reason: null,
        payment_method: unpaid ? null : "mock",
        lines: inv.lines.map((l) => ({
          meter_id: l.meter, tier_label: l.tier, units: l.units, price_per_1000_paise: l.per_1000, amount_paise: l.amount,
        })),
      });
    }
  }

  return {
    version: 1,
    seeded_at: new Date(now).toISOString(),
    meters: [
      { id: "api_calls", name: "API calls", unit: "call", aggregation: "sum" },
      { id: "emails_sent", name: "Emails sent", unit: "email", aggregation: "sum" },
    ],
    plans,
    tenants,
    events,
    invoices,
    seq: { invoice: invoiceId, numbers },
    demoKeys,
  };
}

export { tierLabel };
