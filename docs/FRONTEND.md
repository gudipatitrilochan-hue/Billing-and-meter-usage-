# MeterLedger — Usage-Based Billing / Metering Service

PST_AD_162 · OJT project. Ingests usage events, meters them, and produces tiered invoices.

**Current phase: frontend complete (S1–S9), running on an in-browser mock API.**
The FastAPI + SQLite backend is the next phase. The UI already speaks the PRD Section 9
contract, so switching over is a config change.

## Run it

```bash
npm run dev          # → http://localhost:5173   (Node, no dependencies to install)
npm run test:frontend   # PRD cases C1–C6 against the JS pricing mirror
```

On the sign-in page, **Demo keys** lists the admin key and one key per seeded tenant
(the same thing `scripts/seed.py` will print). Click a key, then **Sign in**.

## What's in the frontend

| Screen | File | Highlights |
|---|---|---|
| S1 Sign in | `index.html` | Role detected from `GET /me`; animated retry tickets; demo keys |
| S2 Overview | `overview.html` | Live revenue count-up, daily usage area chart, KPI cards, recent events, top tenants |
| S3 Tenants | `tenants.html` | Search, estimate per tenant, 80% free-tier flag, New tenant (key shown **once**) |
| S4 Tenant detail | `tenant.html?id=` | Month picker, free-tier bars, daily bar chart, estimate-so-far, change plan, suspend |
| S5 Plans & pricing | `plans.html` | Tilt plan cards, price calculator with animated tier waterfall, create plan / new version |
| S6 Invoices | `invoices.html` | Generate drafts, status filter, finalize / mark paid / void, totals row, CSV export |
| S7 Invoice detail | `invoice.html?id=` | Printable sheet, tier lines, timeline, stale-draft warning, confetti on paid |
| S8 Event simulator | `simulator.html` | Single events + edge cases, FR-03 batch, **retry storm** with particle view and final check |
| S9 Tenant portal | `portal.html` | My usage, free-tier bars, daily chart, my invoices, masked key, sample curl |

Also included: page-transition curtain, ⌘K / Ctrl K command palette, Light/Dark dock with
theme colours, loading / empty / error / success states on every screen, tables become cards
under 576px, and a print stylesheet. All motion turns off under `prefers-reduced-motion`.

## Layout

```
app/static/
  *.html                 one page per screen
  css/themes.css         ALL colour tokens: add themes here
  css/styles.css         design system + page styles
  js/config.js           API_MODE "mock" | "live"
  js/api.js              single door to the backend (mock or fetch)
  js/pricing.js          price_tiers / build_invoice mirror, integer paise
  js/mock/server.js      in-browser implementation of the API contract
  js/mock/seed.js        3 plans, 8 tenants, 3 months of events (C1 + C2 built in)
  js/motion.js           GSAP: transitions, reveals, magnetic, tilt, spotlight, count-up, confetti
  js/ui.js               shell, toasts, modals, states, palette, theme dock
  js/pages/*.js          one module per screen
scripts/dev-server.mjs   static server for the frontend phase
frontend-tests/          node:test checks for pricing
```

## Adding a theme

1. In `css/themes.css`, copy a `[data-theme="…"]` block and change `--accent`, `--accent-strong`,
   `--accent-soft`, `--accent-ink` and `--glow` (an RGB triplet used for the spotlights).
2. Add `{ id, name, swatch }` to `THEMES` in `js/theme.js`.

It then appears in the palette menu of the bottom-right dock, in both Light and Dark.
To restyle more than the accent, override any token from the light or dark blocks inside your theme block.

## Switching to the real backend

Set `API_MODE: "live"` in `js/config.js` (or open any page with `?api=live`). Requests go to
`/api/...` with `X-Api-Key` / `X-Admin-Key`, and errors are expected as `{"error", "detail"}`.

The mock implements every route in PRD Section 9. It also adds a few **read-only extras** the
UI uses, which the backend should provide too:

| Route | Used by | Returns |
|---|---|---|
| `GET /overview?period` (A) | S2 | events_today, active/total tenants, estimated_revenue_paise, open_invoices(+_paise), totals, daily[], tenants[] |
| `GET /events/recent?limit` (T/A) | S2 | last N events with tenant_name |
| `GET /tenants/{id}` (A) | S4 | one tenant |
| `GET /tenants?period` (A) | S3 | each tenant plus `usage` and `estimate_paise` for the period |
| `GET /usage/history` (T/A) | — | per-period totals (spare, for charts) |

Tenants are returned with `key_masked` (e.g. `ml_u8gB…JO8Z`); the raw key is only in the
`POST /tenants` response.

## Verified in the browser (mock API)

- C1 ShopKart ₹3,065.00 and C2 TinyBot ₹0.00 on the seeded invoices; C1–C6 in `npm run test:frontend`
- duplicate → 200, changed data → 409 `event_id_reused`, every 400/409 validation code in Section 12
- batch 3 good / 1 duplicate / 1 bad meter → 3/1/1; batch over 1,000 → 400
- 401 / 403 / 404 isolation; generate twice → one invoice per tenant; finalize → `INV-YYYYMM-NNNN`;
  events after finalize → 409 `period_closed`; pay draft and void paid → 409
- **Retry storm: 20,000 unique events, 100,609 sends, 4 workers → accepted 20,000, zero double counting**
- 375px phone width with no horizontal scroll; light and dark modes
