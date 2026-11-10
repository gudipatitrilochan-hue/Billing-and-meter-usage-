# MeterLedger architecture and flow charts

GitHub draws every diagram on this page from text (Mermaid), so they stay in step with the code.
**Week 1 parts are green**; parts built in later weeks are grey.

- [1. System overview](#1-system-overview)
- [2. Week 1 seed pipeline](#2-week-1-seed-pipeline)
- [3. Graduated pricing](#3-graduated-pricing)
- [4. Worked example C1](#4-worked-example-c1)
- [5. Event ingestion and idempotency](#5-event-ingestion-and-idempotency)
- [6. Retry storm](#6-retry-storm)
- [7. Invoice lifecycle](#7-invoice-lifecycle)
- [8. Data model](#8-data-model)
- [9. Screen map](#9-screen-map)

---

## 1. System overview

```mermaid
flowchart LR
  classDef w1 fill:#dcfce7,stroke:#16a34a,color:#052e16
  classDef later fill:#f4f4f5,stroke:#a1a1aa,color:#3f3f46,stroke-dasharray:4 3
  classDef store fill:#0b0b0c,stroke:#22c55e,color:#f0fdf4

  subgraph Clients
    TS["Tenant servers<br/>X-Api-Key"]:::later
    AD["Admin console S2–S8<br/>X-Admin-Key"]:::later
    TP["Tenant portal S9"]:::later
    SIM["Event simulator<br/>+ retry storm"]:::later
  end

  subgraph API["FastAPI app (Weeks 2–3)"]
    AUTH["auth.py<br/>key → SHA-256 → tenant"]:::later
    ING["ingest.py<br/>validate + idempotent insert"]:::later
    USE["usage / estimate routes"]:::later
    INV["invoices.py<br/>generate · finalize · pay · void"]:::later
  end

  subgraph Core["Week 1"]
    PRICE["pricing.py<br/>price_tiers · build_invoice"]:::w1
    DBPY["db.py<br/>record_event · monthly_usage"]:::w1
    SEED["scripts/seed.py"]:::w1
  end

  DB[("SQLite<br/>schema.sql")]:::store
  CSV["data/cloud_api_usage_sample.csv<br/>data/sample-data.json"]:::w1
  REP["analysis/report.py<br/>3 charts (Week 4)"]:::later

  TS -- "POST /events" --> AUTH
  SIM -- "POST /events/batch" --> AUTH
  AD --> AUTH
  TP --> AUTH
  AUTH --> ING & USE & INV
  ING --> DBPY
  USE --> PRICE
  INV --> PRICE
  USE & INV --> DBPY
  DBPY <--> DB
  CSV --> SEED --> DBPY
  SEED --> PRICE
  DB -- "usage.csv export" --> REP
```

## 2. Week 1 seed pipeline

What `python scripts/seed.py` does, end to end.

```mermaid
flowchart TD
  classDef w1 fill:#dcfce7,stroke:#16a34a,color:#052e16
  classDef out fill:#0b0b0c,stroke:#22c55e,color:#f0fdf4

  A([Start]) --> B["Delete data/meterledger.db<br/>(unless --keep)"]:::w1
  B --> C["Apply app/schema.sql"]:::w1
  C --> D["Read sample-data.json"]:::w1
  D --> E{"validate_tiers()<br/>for every plan + meter"}
  E -- "gap / overlap / open tier not last" --> X["Stop with TierError"]
  E -- ok --> F["Insert meters, plans, price_tiers"]:::w1
  F --> G["Create tenants<br/>new key → store SHA-256 + prefix only"]:::w1
  G --> H["Read cloud_api_usage_sample.csv<br/>2,146 rows"]:::w1
  H --> I{"record_event()<br/>UNIQUE(tenant_id, event_id)"}
  I -- new --> J["accepted<br/>2,063"]:::w1
  I -- "same id, same data" --> K["duplicate skipped<br/>83 retries"]:::w1
  I -- "same id, other data" --> L["conflict<br/>0"]
  J & K & L --> M["Run scripts/monthly_totals.sql"]:::w1
  M --> N["build_invoice() per tenant-month"]:::w1
  N --> O[["Print totals per tenant<br/>ShopKart 2026-09 → ₹3,065.00"]]:::out
```

## 3. Graduated pricing

`price_tiers(units, tiers)` fills tiers in order; each tier is billed at its own rate and each line is
rounded on its own.

```mermaid
flowchart TD
  classDef w1 fill:#dcfce7,stroke:#16a34a,color:#052e16
  S([units, tiers]) --> V{"validate_tiers()"}
  V -- invalid --> E["TierError"]
  V -- valid --> R["remaining = units"]:::w1
  R --> L{"remaining > 0<br/>and tiers left?"}
  L -- no --> T(["return lines"])
  L -- yes --> C["capacity = to − from + 1<br/>(or remaining if to is null)"]:::w1
  C --> K["take = min(remaining, capacity)"]:::w1
  K --> A["amount = (take × price_per_1000 + 500) // 1000"]:::w1
  A --> P["add line: label, units, rate, amount"]:::w1
  P --> D["remaining −= take<br/>next tier"]:::w1
  D --> L
```

`build_invoice(plan, usage)` runs this for every meter, then adds the base fee:
`total = base_fee + Σ line amounts`. All values are integer paise.

## 4. Worked example C1

ShopKart on Starter, September 2026: 135,400 API calls and 2,350 emails.

```mermaid
flowchart LR
  classDef tier fill:#dcfce7,stroke:#16a34a,color:#052e16
  classDef total fill:#22c55e,stroke:#15803d,color:#052e16

  U["135,400 calls"] --> T1["1 – 10,000<br/>10,000 × ₹0/1k<br/>= ₹0.00"]:::tier
  U --> T2["10,001 – 100,000<br/>90,000 × ₹20/1k<br/>= ₹1,800.00"]:::tier
  U --> T3["100,001+<br/>35,400 × ₹15/1k<br/>= ₹531.00"]:::tier
  M["2,350 emails"] --> T4["1+<br/>2,350 × ₹100/1k<br/>= ₹235.00"]:::tier
  B["Base fee ₹499.00"] --> SUM
  T1 & T2 & T3 & T4 --> SUM["49,900 + 0 + 180,000<br/>+ 53,100 + 23,500 paise"]
  SUM --> TOT[["Total ₹3,065.00"]]:::total
```

| Case | Situation | Expected | Test |
|---|---|---|---|
| C1 | ShopKart, Starter, 135,400 calls, 2,350 emails | ₹3,065.00 | `test_c1_shopkart_starter_worked_example` |
| C2 | TinyBot, Free, 8,200 calls | ₹0.00 | `test_c2_tinybot_free_all_in_free_tier` |
| C3 | Starter, exactly 10,000 calls | ₹499.00 | `test_c3_exact_boundary_puts_nothing_in_tier_2` |
| C4 | Starter, 100,001 calls | ₹2,299.02 | `test_c4_one_unit_over_boundary_rounds_half_up` |
| C5 | Free, 12,345 calls | ₹58.63 | `test_c5_free_plan_rounding` |
| C6 | e-1001 sent 3×, e-1002 once | ₹499.00 (800 calls, not 1,800) | `test_c6_retried_events_are_counted_once` |

## 5. Event ingestion and idempotency

`POST /events` (Week 2). Week 1 already has the core of it: `db.record_event` and the UNIQUE constraint.

```mermaid
flowchart TD
  classDef w1 fill:#dcfce7,stroke:#16a34a,color:#052e16
  classDef later fill:#f4f4f5,stroke:#a1a1aa,color:#3f3f46
  classDef ok fill:#22c55e,stroke:#15803d,color:#052e16
  classDef bad fill:#fee2e2,stroke:#dc2626,color:#450a0a

  R(["POST /events<br/>{event_id, meter, quantity, timestamp}"]) --> K{"X-Api-Key valid?"}:::later
  K -- no --> E401["401 bad_key"]:::bad
  K -- suspended --> E403["403 tenant_suspended"]:::bad
  K -- yes --> V{"Body valid?"}:::later
  V -- "bad id / meter / qty / timestamp<br/>or > 5 min in the future" --> E400["400 invalid_*"]:::bad
  V -- yes --> P{"Period finalized?"}:::later
  P -- yes --> E409a["409 period_closed"]:::bad
  P -- no --> I{"INSERT … ON CONFLICT<br/>(tenant_id, event_id) DO NOTHING"}:::w1
  I -- "row inserted" --> A201["201 accepted"]:::ok
  I -- "exists, same data" --> A200["200 duplicate<br/>(counted once)"]:::ok
  I -- "exists, different data" --> E409b["409 event_id_reused"]:::bad
```

## 6. Retry storm

Why a client can safely resend: the database, not the client, decides what is new.

```mermaid
sequenceDiagram
  autonumber
  participant C as Tenant server
  participant A as MeterLedger API
  participant D as SQLite usage_events

  C->>A: POST /events e-1001 (500 calls)
  A->>D: INSERT (t_shopkart, e-1001)
  D-->>A: 1 row inserted
  A--xC: 201 accepted (response lost on the network)
  Note over C: timeout, so retry the same event
  C->>A: POST /events e-1001 (500 calls)
  A->>D: INSERT (t_shopkart, e-1001)
  D-->>A: conflict on UNIQUE(tenant_id, event_id)
  A-->>C: 200 duplicate
  C->>A: POST /events e-1001 (999 calls)
  A-->>C: 409 event_id_reused
  Note over D: usage = 500, never 1,000
```

`scripts/retry_storm.py --seed 7` (Week 2): 20,000 unique events × 1–9 sends, about 100,000 requests from
4 threads. Pass when `accepted = 20,000` and `/usage` totals equal the sum of unique events.

## 7. Invoice lifecycle

```mermaid
stateDiagram-v2
  direction LR
  [*] --> draft: generate (period)
  draft --> draft: regenerate (usage changed)
  draft --> finalized: finalize, number INV-YYYYMM-NNNN
  finalized --> paid: mark paid (mock payment)
  finalized --> void: void (reason required)
  void --> draft: generate again
  paid --> [*]
  note right of finalized
    Period is closed:
    new events get 409 period_closed
  end note
```

Refused moves return `409 invalid_transition`, for example paying a draft or voiding a paid invoice.

## 8. Data model

```mermaid
erDiagram
  PLANS ||--|{ PRICE_TIERS : "has"
  METERS ||--o{ PRICE_TIERS : "priced by"
  PLANS ||--o{ TENANTS : "subscribed by"
  TENANTS ||--o{ USAGE_EVENTS : "sends"
  METERS ||--o{ USAGE_EVENTS : "measures"
  TENANTS ||--o{ INVOICES : "billed on"
  PLANS ||--o{ INVOICES : "priced with"
  INVOICES ||--|{ INVOICE_LINES : "contains"

  METERS {
    TEXT id PK "api_calls | emails_sent"
    TEXT name
    TEXT unit "call | email"
    TEXT aggregation "sum"
  }
  PLANS {
    TEXT id PK
    TEXT name
    INTEGER base_fee_paise ">= 0"
    TEXT currency "INR"
    INTEGER active
    TEXT created_at
  }
  PRICE_TIERS {
    INTEGER id PK
    TEXT plan_id FK
    TEXT meter_id FK
    INTEGER from_unit "first tier = 1"
    INTEGER to_unit "NULL = no limit"
    INTEGER price_per_1000_paise
  }
  TENANTS {
    TEXT id PK
    TEXT name
    TEXT plan_id FK
    TEXT api_key_hash UK "SHA-256 only"
    TEXT key_prefix "first 8 chars"
    TEXT status "active | suspended"
    TEXT created_at
  }
  USAGE_EVENTS {
    INTEGER id PK
    TEXT tenant_id FK "UNIQUE with event_id"
    TEXT event_id
    TEXT meter_id FK
    INTEGER quantity "> 0"
    TEXT occurred_at "UTC ISO"
    TEXT period "YYYY-MM"
    TEXT received_at
  }
  INVOICES {
    INTEGER id PK
    TEXT number UK "set on finalize"
    TEXT tenant_id FK
    TEXT period "one live per tenant"
    TEXT plan_id FK
    TEXT status "draft | finalized | paid | void"
    INTEGER base_fee_paise
    INTEGER total_paise
  }
  INVOICE_LINES {
    INTEGER id PK
    INTEGER invoice_id FK
    TEXT meter_id
    TEXT tier_label "10,001 to 100,000"
    INTEGER units
    INTEGER price_per_1000_paise
    INTEGER amount_paise
  }
```

## 9. Screen map

The web screens from PRD Section 10 (Weeks 3–4).

```mermaid
flowchart LR
  classDef later fill:#f4f4f5,stroke:#a1a1aa,color:#3f3f46
  S1["S1 Sign in<br/>role from GET /me"]:::later
  S1 -- admin key --> S2["S2 Overview"]:::later
  S1 -- tenant key --> S9["S9 Tenant portal"]:::later
  S3["S3 Tenants"]:::later
  S4["S4 Tenant detail"]:::later
  S5["S5 Plans & pricing"]:::later
  S6["S6 Invoices"]:::later
  S7["S7 Invoice detail"]:::later
  S8["S8 Event simulator<br/>retry storm"]:::later
  S2 --> S3 --> S4
  S2 --> S5
  S2 --> S6 --> S7
  S2 --> S8
```
