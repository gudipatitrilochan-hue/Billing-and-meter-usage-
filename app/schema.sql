-- MeterLedger schema (PRD Section 8). SQLite 3.
-- Money is always INTEGER paise. Timestamps are UTC ISO-8601 text ("2026-09-01T04:51:10Z").
-- Billing periods are UTC calendar months written "YYYY-MM".

PRAGMA foreign_keys = ON;

-- Seeded, read-only in the MVP.
CREATE TABLE IF NOT EXISTS meters (
    id          TEXT PRIMARY KEY CHECK (id IN ('api_calls', 'emails_sent', 'pdf_links')),
    name        TEXT NOT NULL,
    unit        TEXT NOT NULL,                      -- 'call' | 'email' | 'pdf'
    aggregation TEXT NOT NULL DEFAULT 'sum' CHECK (aggregation = 'sum')
);

CREATE TABLE IF NOT EXISTS plans (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    base_fee_paise INTEGER NOT NULL CHECK (base_fee_paise >= 0),
    currency       TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
    active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at     TEXT NOT NULL
);

-- Per plan and meter: first tier starts at 1, tiers are contiguous with no gaps or overlaps,
-- and only the last tier has to_unit = NULL. app/pricing.py:validate_tiers enforces the
-- contiguity rules before rows are written; the constraints below catch the rest.
CREATE TABLE IF NOT EXISTS price_tiers (
    id                   INTEGER PRIMARY KEY,
    plan_id              TEXT NOT NULL REFERENCES plans(id),
    meter_id             TEXT NOT NULL REFERENCES meters(id),
    from_unit            INTEGER NOT NULL CHECK (from_unit >= 1),
    to_unit              INTEGER CHECK (to_unit IS NULL OR to_unit >= from_unit),
    price_per_1000_paise INTEGER NOT NULL CHECK (price_per_1000_paise >= 0),
    UNIQUE (plan_id, meter_id, from_unit)
);

-- The raw API key is shown once at creation and never stored; only its SHA-256 hash is kept.
CREATE TABLE IF NOT EXISTS tenants (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    plan_id      TEXT NOT NULL REFERENCES plans(id),
    api_key_hash TEXT NOT NULL UNIQUE,
    key_prefix   TEXT NOT NULL,                     -- first 8 chars, for display only
    status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at   TEXT NOT NULL
);

-- UNIQUE(tenant_id, event_id) is the idempotency guarantee: a retried event can never be
-- stored (or billed) twice.
CREATE TABLE IF NOT EXISTS usage_events (
    id          INTEGER PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    event_id    TEXT NOT NULL CHECK (length(event_id) BETWEEN 1 AND 128),
    meter_id    TEXT NOT NULL REFERENCES meters(id),
    quantity    INTEGER NOT NULL CHECK (quantity > 0),
    occurred_at TEXT NOT NULL,
    period      TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    received_at TEXT NOT NULL,
    UNIQUE (tenant_id, event_id)
);
CREATE INDEX IF NOT EXISTS ix_usage_tenant_period_meter
    ON usage_events (tenant_id, period, meter_id);

-- Week 3 fills these in; the tables exist from Week 1 so the schema is complete.
CREATE TABLE IF NOT EXISTS invoices (
    id             INTEGER PRIMARY KEY,
    number         TEXT UNIQUE,                     -- INV-YYYYMM-NNNN, assigned only on finalize
    tenant_id      TEXT NOT NULL REFERENCES tenants(id),
    period         TEXT NOT NULL,
    plan_id        TEXT NOT NULL REFERENCES plans(id),
    status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'finalized', 'paid', 'void')),
    base_fee_paise INTEGER NOT NULL CHECK (base_fee_paise >= 0),
    total_paise    INTEGER NOT NULL CHECK (total_paise >= 0),
    created_at     TEXT NOT NULL,
    finalized_at   TEXT,
    paid_at        TEXT,
    void_reason    TEXT
);
-- One live invoice per tenant per month; a voided one may be replaced.
CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_tenant_period_live
    ON invoices (tenant_id, period) WHERE status <> 'void';

-- Lines are a snapshot: later plan edits never change them.
CREATE TABLE IF NOT EXISTS invoice_lines (
    id                   INTEGER PRIMARY KEY,
    invoice_id           INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    meter_id             TEXT NOT NULL,
    tier_label           TEXT NOT NULL,             -- e.g. '10,001 to 100,000'
    units                INTEGER NOT NULL CHECK (units >= 0),
    price_per_1000_paise INTEGER NOT NULL CHECK (price_per_1000_paise >= 0),
    amount_paise         INTEGER NOT NULL CHECK (amount_paise >= 0)
);

-- PDF links: a tenant uploads a PDF, the server stores the file and returns a link that opens it.
-- Each upload is also one usage event on the pdf_links meter (priced ₹20 per PDF in every plan),
-- so the charge flows through the same idempotent usage_events table and pricing engine.
-- event_id is "pdf-" + the client's Idempotency-Key (or the token), so a retried upload is never billed twice.
CREATE TABLE IF NOT EXISTS pdf_links (
    token       TEXT PRIMARY KEY CHECK (length(token) >= 16),   -- unguessable, used in the link /p/{token}
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    event_id    TEXT NOT NULL,
    filename    TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL CHECK (size_bytes > 0),
    sha256      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE (tenant_id, event_id)
);
CREATE INDEX IF NOT EXISTS ix_pdf_links_tenant ON pdf_links (tenant_id, created_at);
