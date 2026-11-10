# MeterLedger: one-page brief

**Project:** PST_AD_162 · Usage-Based Billing / Metering Service · FinTech
**Status:** Week 1 of 4 (Pricing & data) complete
**Stack:** Python 3 · SQLite · pytest → FastAPI (Week 2) → Bootstrap 5 + vanilla JS + Chart.js (Week 3) → pandas/matplotlib, Render (Week 4)

## The problem

Small API companies bill from server logs: someone exports a CSV at month end, adds it up in a spreadsheet
and types totals into an invoice. Two things go wrong. **Retries are counted twice**: a client that
times out resends the same event, so the log has it twice. **Tier boundaries are priced wrong**:
a "first 10,000 free, then ₹20 per 1,000" rule gets applied to all units, or rounded at the end
instead of per line.

## Who it is for

| User | Needs |
|---|---|
| Billing admin at an API startup | Correct monthly invoices per customer, without spreadsheets |
| Tenant (a customer company) | Send usage safely, even with retries; see its own usage and bills |
| Developer of the tenant's server | A simple, idempotent HTTP API with clear errors |

## What we build

1. **Idempotent ingestion:** each usage event has an `event_id`; `UNIQUE(tenant_id, event_id)` stores it exactly once.
2. **Metering:** sum events per tenant, per meter (`api_calls`, `emails_sent`), per UTC calendar month.
3. **Graduated tiered pricing:** exact integer paise, each tier line rounded half up on its own.
4. **Invoice lifecycle:** draft → finalized (numbered, period locked) → paid, or void.
5. **Admin console, tenant portal, event simulator with retry storm, analysis charts.**

Out of scope: taxes/GST, multiple currencies, proration, refunds, real card payments, Kafka/Kinesis.

## How we know it works

| Metric | Pass when |
|---|---|
| Invoice maths matches hand-computed cases | C1–C6 match to the paisa (C1 = ₹3,065.00) |
| Zero double counting | Retry storm: 20,000 unique events, ~100,000 sends, 4 threads → exactly 20,000 stored |
| Isolation | A tenant key never sees another tenant's data (404 for their invoices, 403 for admin routes) |
| Telemetry | `analysis/report.py` saves 3 charts, including a box plot of monthly usage per tenant |

## Plan

| Week | Theme | Checkpoint |
|---|---|---|
| **1** | **Pricing & data**: brief, repo, `pricing.py` + six tests, `schema.sql`, `seed.py`, totals query | **Six pricing tests green; seed totals printed per tenant ✅** |
| 2 | Ingestion API: auth, `/events`, `/events/batch`, usage/estimate, tenants/plans, `retry_storm.py` | Retry storm passes; all endpoints work from `/docs` |
| 3 | Invoices & console: generate/finalize/pay/void, screens S1–S7 and S9 | Send events → generate → finalize → pay works in the browser |
| 4 | Analysis & ship: CSV export, `report.py`, simulator S8, accessibility, deploy, demo | Section 15 checklist passes; live URL or video |

## Risks and how we handle them

| Risk | Mitigation |
|---|---|
| Float rounding errors in money | Integers only (paise); one rounding rule; tests on every boundary |
| Double counting under concurrency | Database constraint, not application checks, decides uniqueness |
| Leaked API keys | Store only SHA-256 hashes; show the raw key once |
| Editing a plan changes old invoices | Invoice lines are a snapshot; plans used on finalized invoices get a new version instead |
