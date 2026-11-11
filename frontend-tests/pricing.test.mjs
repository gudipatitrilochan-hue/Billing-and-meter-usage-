// Run: node --test meterledger/frontend-tests/
// PRD Section 15 cases C1–C6 against the JS pricing mirror.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvoice, priceTiers, formatINR, rupeesToPaise, validateTiers } from "../app/static/js/pricing.js";

const starter = {
  base_fee_paise: 49900,
  tiers: {
    api_calls: [{ from: 1, to: 10000, per_1000: 0 }, { from: 10001, to: 100000, per_1000: 2000 }, { from: 100001, to: null, per_1000: 1500 }],
    emails_sent: [{ from: 1, to: null, per_1000: 10000 }],
  },
};
const free = {
  base_fee_paise: 0,
  tiers: {
    api_calls: [{ from: 1, to: 10000, per_1000: 0 }, { from: 10001, to: null, per_1000: 2500 }],
    emails_sent: [{ from: 1, to: null, per_1000: 10000 }],
  },
};

test("C1 ShopKart Starter 135,400 calls + 2,350 emails = ₹3,065.00", () => {
  const inv = buildInvoice(starter, { api_calls: 135400, emails_sent: 2350 });
  assert.equal(inv.total, 306500);
  assert.equal(formatINR(inv.total), "₹3,065.00");
  assert.deepEqual(inv.lines.map((l) => l.amount), [0, 180000, 53100, 23500]);
  assert.deepEqual(inv.lines.map((l) => l.tier), ["1 to 10,000", "10,001 to 100,000", "100,001+", "1+"]);
});
test("C2 TinyBot Free 8,200 calls = ₹0.00", () => {
  assert.equal(buildInvoice(free, { api_calls: 8200, emails_sent: 0 }).total, 0);
});
test("C3 boundary exactly 10,000 → ₹499.00, no tier-2 line", () => {
  const inv = buildInvoice(starter, { api_calls: 10000, emails_sent: 0 });
  assert.equal(inv.total, 49900);
  assert.equal(inv.lines.length, 1);
});
test("C4 100,001 calls → ₹2,299.02 (round half up)", () => {
  assert.equal(buildInvoice(starter, { api_calls: 100001, emails_sent: 0 }).total, 229902);
});
test("C5 Free 12,345 calls → ₹58.63", () => {
  const inv = buildInvoice(free, { api_calls: 12345, emails_sent: 0 });
  assert.equal(inv.total, 5863);
  assert.equal(formatINR(inv.total), "₹58.63");
});
test("C6 dedupe 500+300 = 800 calls → ₹499.00", () => {
  assert.equal(buildInvoice(starter, { api_calls: 800, emails_sent: 0 }).total, 49900);
});
test("helpers", () => {
  assert.equal(rupeesToPaise("499"), 49900);
  assert.equal(rupeesToPaise("₹1,999.5"), 199950);
  assert.equal(rupeesToPaise("0.1"), 10);
  assert.equal(rupeesToPaise("abc"), null);
  assert.equal(priceTiers(0, starter.tiers.api_calls).length, 0);
  assert.equal(validateTiers(starter.tiers.api_calls), null);
  assert.match(validateTiers([{ from: 1, to: 100, per_1000: 0 }, { from: 102, to: null, per_1000: 5 }]).message, /start at 101/);
});
