"""MeterLedger pricing engine (PRD Sections 8 and 15).

Pure functions with no I/O, so they are easy to test and reuse from the API later.

Money rules
-----------
* Every amount is an ``int`` number of paise (100 paise = ₹1). No floats anywhere.
* Prices are per 1,000 units: ``price_per_1000_paise = 2000`` means ₹20 per 1,000 calls.
* Each tier line is rounded on its own, half up, to the nearest paisa:
  ``amount = (units * price_per_1000 + 500) // 1000``.

Tiers are *graduated*: units fill tier 1 first, the overflow goes to tier 2, and so on.
Every tier is billed at its own rate (unlike volume pricing, where one rate covers all units).
"""
from __future__ import annotations

from typing import Mapping, Sequence

METERS = ("api_calls", "emails_sent")

#: A tier as it appears in sample-data.json: {"from": 1, "to": 10000, "per_1000": 0}.
#: ``to`` is None for the last, open-ended tier.
Tier = Mapping[str, "int | None"]


class TierError(ValueError):
    """Raised when a list of tiers breaks the PRD Section 8 rules."""


def line_amount(units: int, price_per_1000_paise: int) -> int:
    """Price ``units`` at a per-1,000 rate, rounded half up to a whole paisa."""
    if units < 0 or price_per_1000_paise < 0:
        raise ValueError("units and price must be >= 0")
    return (units * price_per_1000_paise + 500) // 1000


def tier_label(from_unit: int, to_unit: int | None) -> str:
    """Human label stored on invoice lines, e.g. ``"10,001 to 100,000"`` or ``"100,001+"``."""
    if to_unit is None:
        return f"{from_unit:,}+"
    return f"{from_unit:,} to {to_unit:,}"


def validate_tiers(tiers: Sequence[Tier]) -> None:
    """Check one meter's tiers: start at 1, contiguous, no gaps or overlaps, only the last open.

    Raises :class:`TierError` with a message that names the offending tier (1-based).
    """
    if not tiers:
        raise TierError("a meter needs at least one tier")
    expected_from = 1
    for i, tier in enumerate(tiers, start=1):
        start, end, price = tier["from"], tier["to"], tier["per_1000"]
        if not isinstance(start, int) or isinstance(start, bool):
            raise TierError(f"tier {i}: 'from' must be a whole number")
        if start != expected_from:
            kind = "gap" if start > expected_from else "overlap"
            raise TierError(f"tier {i}: starts at {start:,} but should start at {expected_from:,} ({kind})")
        if not isinstance(price, int) or isinstance(price, bool) or price < 0:
            raise TierError(f"tier {i}: price per 1,000 must be a whole number of paise >= 0")
        is_last = i == len(tiers)
        if end is None:
            if not is_last:
                raise TierError(f"tier {i}: only the last tier may have no upper limit")
            return
        if not isinstance(end, int) or isinstance(end, bool) or end < start:
            raise TierError(f"tier {i}: 'to' must be a whole number >= 'from'")
        if is_last:
            raise TierError(f"tier {i}: the last tier must have no upper limit (to = null)")
        expected_from = end + 1


def price_tiers(units: int, tiers: Sequence[Tier]) -> list[dict]:
    """Split ``units`` across graduated ``tiers`` and price each slice.

    Returns one line per tier that received units (a tier with 0 units gets no line):
    ``{"tier_label", "from_unit", "to_unit", "units", "price_per_1000_paise", "amount_paise"}``.
    """
    if not isinstance(units, int) or isinstance(units, bool) or units < 0:
        raise ValueError("units must be a whole number >= 0")
    validate_tiers(tiers)
    lines: list[dict] = []
    remaining = units
    for tier in tiers:
        if remaining == 0:
            break
        start, end, price = tier["from"], tier["to"], tier["per_1000"]
        capacity = remaining if end is None else end - start + 1
        take = min(remaining, capacity)
        lines.append({
            "tier_label": tier_label(start, end),
            "from_unit": start,
            "to_unit": end,
            "units": take,
            "price_per_1000_paise": price,
            "amount_paise": line_amount(take, price),
        })
        remaining -= take
    return lines


def build_invoice(plan: Mapping, usage: Mapping[str, int]) -> dict:
    """Price one tenant's monthly usage on ``plan``.

    ``plan`` uses the sample-data.json shape::

        {"id": "starter", "base_fee_paise": 49900,
         "tiers": {"api_calls": [{"from": 1, "to": 10000, "per_1000": 0}, ...], ...}}

    ``usage`` maps meter id to total units, e.g. ``{"api_calls": 135400, "emails_sent": 2350}``.
    Meters missing from ``usage`` count as 0. Usage for a meter the plan does not price is an error,
    so nothing is ever silently left off an invoice.
    """
    base = plan.get("base_fee_paise", 0)
    if not isinstance(base, int) or isinstance(base, bool) or base < 0:
        raise ValueError("base_fee_paise must be a whole number of paise >= 0")
    tiers_by_meter = plan["tiers"]
    unknown = [m for m, units in usage.items() if units and m not in tiers_by_meter]
    if unknown:
        raise ValueError(f"plan {plan.get('id')!r} has no tiers for meter(s): {', '.join(sorted(unknown))}")

    lines: list[dict] = []
    for meter, tiers in tiers_by_meter.items():
        for line in price_tiers(usage.get(meter, 0), tiers):
            lines.append({"meter_id": meter, **line})
    total = base + sum(line["amount_paise"] for line in lines)
    return {"plan_id": plan.get("id"), "base_fee_paise": base, "lines": lines, "total_paise": total}


def format_inr(paise: int) -> str:
    """``306500`` → ``"₹3,065.00"`` (Western digit grouping, as used throughout the PRD)."""
    sign = "-" if paise < 0 else ""
    rupees, p = divmod(abs(paise), 100)
    return f"{sign}₹{rupees:,}.{p:02d}"

