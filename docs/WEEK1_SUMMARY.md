# Week 1 summary: Pricing & data

**Project:** MeterLedger · PST_AD_162 · Usage-Based Billing / Metering Service
**Week:** 1 of 4 · **Status:** ✅ complete, merged into `main` (pull request #1)
**Checkpoint (PRD Section 14):** "Six pricing tests green; seed totals printed per tenant": **met**

---

## 1. Goal for the week

Build the part of the system that has to be exactly right before any API or screen exists: the
**money maths** and the **data**. Concretely, PRD Section 14 asks for:

| # | Deliverable | Status | Where |
|---|---|:---:|---|
| 1 | One-page brief | ✅ | [`docs/BRIEF.md`](BRIEF.md) |
| 2 | Repo and README skeleton | ✅ | [`README.md`](../README.md), [`docs/`](.) |
| 3 | `pricing.py` with all six Section 15 cases as tests | ✅ | [`app/pricing.py`](../app/pricing.py), [`tests/test_pricing.py`](../tests/test_pricing.py) |
| 4 | `schema.sql` | ✅ | [`app/schema.sql`](../app/schema.sql) |
| 5 | `seed.py` that loads plans, tenants and events from the CSV | ✅ | [`scripts/seed.py`](../scripts/seed.py), [`data/`](../data/) |
| 6 | SQL query that prints monthly totals | ✅ | [`scripts/monthly_totals.sql`](../scripts/monthly_totals.sql) |

Extras delivered: logo and banner ([`docs/brand/`](brand/)), nine architecture and flow diagrams
([`docs/ARCHITECTURE.md`](ARCHITECTURE.md)), and a deterministic generator for the sample CSV.

## 2. What was built

### Pricing engine: `app/pricing.py`
Pure functions with no I/O, so they can be tested alone and reused by the API in Week 2.

* `price_tiers(units, tiers)` splits usage across **graduated** tiers and prices each slice.
* `build_invoice(plan, usage)` prices every meter, adds the base fee and returns lines plus total.
* `validate_tiers(tiers)` enforces the PRD rules: starts at 1, no gaps, no overlaps, only the last tier open-ended.
* `line_amount()` applies the single rounding rule: `(units × price_per_1000 + 500) // 1000`.
* `format_inr()` formats paise as rupees, for example `306500` → `₹3,065.00`.

All money is **integer paise**; there are no floats anywhere in the calculation.

### Database: `app/schema.sql` + `app/db.py`
All seven tables from PRD Section 8: `meters`, `plans`, `price_tiers`, `tenants`, `usage_events`,
`invoices`, `invoice_lines`. The important constraints:

* `UNIQUE(tenant_id, event_id)` on `usage_events` is the **idempotency guarantee**.
* Tenants store only the **SHA-256 hash** of their API key and an 8-character prefix.
* One live invoice per tenant per month, enforced by a partial unique index that ignores void invoices.
* `CHECK` constraints on money (≥ 0), quantities (> 0), statuses and the `YYYY-MM` period format.

`db.record_event()` inserts with `ON CONFLICT DO NOTHING` and reports `accepted`, `duplicate`
(same event resent) or `conflict` (same id, different data). Week 2's `POST /events` builds on it.

### Data and seed: `data/` + `scripts/seed.py`
* `sample-data.json`: 2 meters, 3 plans (Free, Starter, Growth) with their tiers, 6 tenants.
* `cloud_api_usage_sample.csv`: a simulated metering export, 6 tenants × 3 months (Jul–Sep 2026).
  It contains the C1 and C2 totals and **82 planted retry rows**, the kind a spreadsheet double-counts.
* `seed.py` builds the database, creates tenant keys (shown once, stored hashed), loads every event
  through `record_event()`, then runs `monthly_totals.sql` and prices each tenant-month.

## 3. Checkpoint evidence

### Six pricing tests green ✅

```text
$ python -m pytest
.....................................                                    [100%]
37 passed in 0.13s
```

| Case | Situation | Expected | Result |
|---|---|---:|:---:|
| C1 | ShopKart, Starter, 135,400 calls, 2,350 emails | ₹3,065.00 | ✅ |
| C2 | TinyBot, Free, 8,200 calls | ₹0.00 | ✅ |
| C3 | Starter, exactly 10,000 calls (boundary) | ₹499.00 | ✅ |
| C4 | Starter, 100,001 calls (boundary + rounding) | ₹2,299.02 | ✅ |
| C5 | Free, 12,345 calls (rounding) | ₹58.63 | ✅ |
| C6 | e-1001 sent three times + e-1002 once | ₹499.00 (800 calls, not 1,800) | ✅ |

The other 31 tests cover the rules behind the cases: rounding on 6 inputs, 8 kinds of invalid tiers,
zero usage, units adding up across tiers, labels, rupee formatting, and 4 seed checks (C1/C2 totals
from the CSV, retries stored once, only key hashes stored, totals printed for every tenant).

### Seed totals printed per tenant ✅

```text
$ python scripts/seed.py
Events read 2,146 · accepted 2,063 · duplicates skipped 83 · conflicts 0 · rows in usage_events 2,063

Tenant       Plan     Period    API calls   Emails  Events  Invoice estimate
----------------------------------------------------------------------------
Lumen Labs   growth   2026-07     188,000    3,900     161         ₹3,655.00
Lumen Labs   growth   2026-08     204,600    4,250     175         ₹3,854.20
Lumen Labs   growth   2026-09     231,750    4,610     194         ₹4,180.00
MediMinder   free     2026-07      11,900      310      12            ₹78.50
MediMinder   free     2026-08      13,450      365      14           ₹122.75
MediMinder   free     2026-09      12,345      400      14            ₹98.63
PayNest      growth   2026-07     412,000    6,800     315         ₹6,487.00
PayNest      growth   2026-08     468,500    7,450     352         ₹7,217.00
PayNest      growth   2026-09     521,300    8,120     388         ₹7,819.00
QuickCab     starter  2026-07      64,200      880      44         ₹1,671.00
QuickCab     starter  2026-08      71,800      940      48         ₹1,829.00
QuickCab     starter  2026-09      69,500    1,010      49         ₹1,790.00
ShopKart     starter  2026-07      98,700    1,920      81         ₹2,465.00
ShopKart     starter  2026-08     117,250    2,080      92         ₹2,765.75
ShopKart     starter  2026-09     135,400    2,350     106         ₹3,065.00
TinyBot      free     2026-07       5,400        0       6             ₹0.00
TinyBot      free     2026-08       6,900        0       6             ₹0.00
TinyBot      free     2026-09       8,200        0       6             ₹0.00
```

* **83 duplicates skipped** = 82 retry rows in the CSV + 1 event that also appears in the JSON excerpt.
  Every one was stored once; a month-end spreadsheet would have billed all 83 again.
* **ShopKart, September 2026 = ₹3,065.00**, matching C1, and **TinyBot = ₹0.00**, matching C2.
* Hand check of one row: PayNest Sep on Growth = ₹1,999 base + ₹5,400 + ₹170.40 (calls) + ₹249.60 (emails)
  = **₹7,819.00** ✔.

## 4. Key decisions

| Decision | Why |
|---|---|
| Money as integer paise, never floats | `0.1 + 0.2 ≠ 0.3` in floating point; billing must match to the paisa |
| Round **each tier line** half up, not the total | The PRD's rule; C4 and C5 prove it (`1 × 1,500 → 2 paise`) |
| A tier with 0 units gets **no line** | C3: exactly 10,000 calls shows only the free-tier line |
| Idempotency in the **database** (UNIQUE constraint) | Safe under concurrent retries; application checks alone can race |
| Same id + different data = **conflict**, never overwrite | Protects stored usage; becomes `409 event_id_reused` in Week 2 |
| Store only the **SHA-256** of API keys | A database leak does not leak working keys |
| `pricing.py` has **no I/O** | Easy to test; the API, seed and invoices share one implementation |
| Deterministic CSV generator | The same data every run, so the tests and the README numbers stay valid |

## 5. What we learned (PRD "Learn" column)

* **Usage-based pricing:** graduated tiers (each slice at its own rate) versus volume tiers (one rate for all).
* **Why money uses integers,** and why rounding has to happen at one agreed place.
* **Python:** pure functions, dicts as plan data, raising clear errors (`TierError`).
* **pytest:** plain `assert`, `parametrize` for boundary tables, `tmp_path` and `monkeypatch` for an isolated database.
* **SQL:** `CREATE TABLE` with `CHECK` / `UNIQUE` / foreign keys, `INSERT … ON CONFLICT DO NOTHING`,
  `SUM(CASE …)` with `GROUP BY` for monthly totals, and partial unique indexes.
* **Git:** feature branch → pull request → review → merge.

## 6. By the numbers

| | |
|---|---:|
| Python + SQL lines (app, scripts, tests) | 752 |
| Tests | 37 passing (0.13 s) |
| PRD cases C1–C6 | 6 / 6 |
| CSV rows / unique events / retries caught | 2,146 / 2,063 / 83 |
| Tenants × months seeded | 6 × 3 |
| Diagrams | 11 (2 in the README, 9 in ARCHITECTURE.md) |

## 7. Open items carried to Week 2

* Add the GitHub Actions test workflow. It is written but needs the GitHub login's `workflow` permission to push.
* `received_at` uses the current time; Week 2 adds the "more than 5 minutes in the future → 400" rule on `occurred_at`.

## 8. Next: Week 2, Ingestion API

FastAPI app with API-key and admin-key auth; `POST /events` and `/events/batch` (≤ 1,000) using
`record_event()`; `/me`, `/usage`, `/usage/daily`, `/usage/estimate`; tenants and plans endpoints;
`scripts/retry_storm.py --seed 7`.
**Checkpoint:** retry storm passes with zero double counting, and all endpoints work from `/docs`.
