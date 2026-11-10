"""Generate data/cloud_api_usage_sample.csv, the simulated metering export the seed loads.

The PRD's dataset is a simulated AWS/GCP API-usage metering CSV, so this script builds one
deterministically (same seed → same file). It is already committed; rerun it only to change the data:

    python scripts/generate_sample_csv.py

Built-in checks:
* C1: ShopKart, September 2026 = 135,400 API calls and 2,350 emails  → ₹3,065.00 on Starter
* C2: TinyBot,  September 2026 =   8,200 API calls and 0 emails      → ₹0.00 on Free
* About 4% of rows are exact retries of an earlier row (same event_id). A month-end spreadsheet
  would count them twice; the seed must count them once.
"""
from __future__ import annotations

import calendar
import csv
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "cloud_api_usage_sample.csv"
SEED = 20260901
RETRY_SHARE = 0.04

# tenant_id: (event-id prefix, {period: (api_calls, emails_sent)})
TARGETS = {
    "t_shopkart":   ("shk", {"2026-07": (98_700, 1_920),   "2026-08": (117_250, 2_080), "2026-09": (135_400, 2_350)}),
    "t_tinybot":    ("tnb", {"2026-07": (5_400, 0),        "2026-08": (6_900, 0),       "2026-09": (8_200, 0)}),
    "t_paynest":    ("pyn", {"2026-07": (412_000, 6_800),  "2026-08": (468_500, 7_450), "2026-09": (521_300, 8_120)}),
    "t_quickcab":   ("qcb", {"2026-07": (64_200, 880),     "2026-08": (71_800, 940),    "2026-09": (69_500, 1_010)}),
    "t_mediminder": ("mdm", {"2026-07": (11_900, 310),     "2026-08": (13_450, 365),    "2026-09": (12_345, 400)}),
    "t_lumenlabs":  ("lml", {"2026-07": (188_000, 3_900),  "2026-08": (204_600, 4_250), "2026-09": (231_750, 4_610)}),
}
# The PRD's sample-data.json excerpt: this exact event must exist in the CSV too.
ANCHOR = ("t_shopkart", "2026-09", "api_calls", 500, datetime(2026, 9, 1, 4, 51, 10, tzinfo=timezone.utc))


def split(total: int, parts: int, rng: random.Random) -> list[int]:
    """Split ``total`` into ``parts`` positive integers that add up exactly."""
    if total == 0:
        return []
    parts = max(1, min(parts, total))
    weights = [rng.uniform(0.4, 1.6) for _ in range(parts)]
    scale = sum(weights)
    out = [max(1, int(total * w / scale)) for w in weights]
    diff = total - sum(out)
    i = 0
    while diff != 0:
        j = i % parts
        if diff > 0:
            out[j] += 1; diff -= 1
        elif out[j] > 1:
            out[j] -= 1; diff += 1
        i += 1
    return out


def random_time(period: str, rng: random.Random) -> datetime:
    year, month = map(int, period.split("-"))
    days = calendar.monthrange(year, month)[1]
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    return start + timedelta(seconds=rng.randrange(days * 86_400))


def main() -> None:
    rng = random.Random(SEED)
    rows: list[dict] = []
    for tenant_id, (prefix, months) in TARGETS.items():
        for period, (calls, emails) in months.items():
            events: list[tuple[datetime, str, int]] = []
            anchored = (tenant_id, period) == ANCHOR[:2]
            call_total = calls - ANCHOR[3] if anchored else calls
            for meter, total, per_event in (("api_calls", call_total, 2_500), ("emails_sent", emails, 45)):
                for qty in split(total, max(6, total // per_event), rng):
                    t = random_time(period, rng)
                    if anchored and t <= ANCHOR[4] + timedelta(seconds=1):
                        t = ANCHOR[4] + timedelta(seconds=rng.randrange(60, 86_400))
                    events.append((t, meter, qty))
            if anchored:
                events.append((ANCHOR[4], ANCHOR[2], ANCHOR[3]))
            events.sort()
            seq_by_day: dict[str, int] = {}
            for t, meter, qty in events:
                day = t.strftime("%Y-%m-%d")
                seq_by_day[day] = seq_by_day.get(day, 0) + 1
                rows.append({
                    "tenant_id": tenant_id,
                    "event_id": f"{prefix}-{day}-{seq_by_day[day]:04d}",
                    "meter": meter,
                    "quantity": qty,
                    "timestamp": t.strftime("%Y-%m-%dT%H:%M:%SZ"),
                })

    # Retries: the client timed out and sent the very same event again.
    retries = [dict(r) for r in rng.sample(rows, int(len(rows) * RETRY_SHARE))]
    rows.extend(retries)
    rows.sort(key=lambda r: (r["timestamp"], r["tenant_id"], r["event_id"]))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["tenant_id", "event_id", "meter", "quantity", "timestamp"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {len(rows):,} rows ({len(retries):,} retries) to {OUT.relative_to(OUT.parent.parent)}")


if __name__ == "__main__":
    main()
