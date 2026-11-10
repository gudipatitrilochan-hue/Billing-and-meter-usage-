"""PRD Section 15 cases C1–C6, plus the rules the cases depend on."""
import json
from pathlib import Path

import pytest

from app import db
from app.pricing import (TierError, build_invoice, format_inr, line_amount, price_tiers, tier_label,
                         validate_tiers)

DATA = json.loads((Path(__file__).resolve().parent.parent / "data" / "sample-data.json").read_text())
PLANS = {p["id"]: p for p in DATA["plans"]}
STARTER, FREE = PLANS["starter"], PLANS["free"]


# ---------------------------------------------------------------- the six PRD cases

def test_c1_shopkart_starter_worked_example():
    inv = build_invoice(STARTER, {"api_calls": 135_400, "emails_sent": 2_350})
    lines = [(l["meter_id"], l["tier_label"], l["units"], l["amount_paise"]) for l in inv["lines"]]
    assert lines == [
        ("api_calls", "1 to 10,000", 10_000, 0),
        ("api_calls", "10,001 to 100,000", 90_000, 180_000),
        ("api_calls", "100,001+", 35_400, 53_100),
        ("emails_sent", "1+", 2_350, 23_500),
    ]
    assert sum(l["units"] for l in inv["lines"] if l["meter_id"] == "api_calls") == 135_400
    assert inv["base_fee_paise"] == 49_900
    assert inv["total_paise"] == 306_500
    assert format_inr(inv["total_paise"]) == "₹3,065.00"


def test_c2_tinybot_free_all_in_free_tier():
    inv = build_invoice(FREE, {"api_calls": 8_200, "emails_sent": 0})
    assert [(l["tier_label"], l["units"], l["amount_paise"]) for l in inv["lines"]] == [("1 to 10,000", 8_200, 0)]
    assert inv["total_paise"] == 0
    assert format_inr(inv["total_paise"]) == "₹0.00"


def test_c3_exact_boundary_puts_nothing_in_tier_2():
    inv = build_invoice(STARTER, {"api_calls": 10_000, "emails_sent": 0})
    assert [l["tier_label"] for l in inv["lines"]] == ["1 to 10,000"]  # tier 2 gets 0 units, no line
    assert inv["total_paise"] == 49_900
    assert format_inr(inv["total_paise"]) == "₹499.00"


def test_c4_one_unit_over_boundary_rounds_half_up():
    inv = build_invoice(STARTER, {"api_calls": 100_001})
    tier3 = inv["lines"][-1]
    assert (tier3["tier_label"], tier3["units"], tier3["amount_paise"]) == ("100,001+", 1, 2)  # (1,500+500)//1,000
    assert inv["total_paise"] == 229_902
    assert format_inr(inv["total_paise"]) == "₹2,299.02"


def test_c5_free_plan_rounding():
    inv = build_invoice(FREE, {"api_calls": 12_345})
    paid = inv["lines"][-1]
    assert (paid["units"], paid["amount_paise"]) == (2_345, 5_863)  # (5,862,500+500)//1,000
    assert format_inr(inv["total_paise"]) == "₹58.63"


def test_c6_retried_events_are_counted_once(tmp_path):
    conn = db.connect(tmp_path / "c6.db")
    db.init_schema(conn)
    conn.execute("INSERT INTO meters VALUES ('api_calls', 'API calls', 'call', 'sum')")
    conn.execute("INSERT INTO plans VALUES ('starter', 'Starter', 49900, 'INR', 1, '2026-09-01T00:00:00Z')")
    conn.execute("INSERT INTO tenants VALUES ('t_shopkart', 'ShopKart', 'starter', 'hash', 'ml_xxxxx',"
                 " 'active', '2026-09-01T00:00:00Z')")
    send = lambda eid, qty: db.record_event(conn, "t_shopkart", eid, "api_calls", qty, "2026-09-03T10:00:00Z")

    assert [send("e-1001", 500) for _ in range(3)] == ["accepted", "duplicate", "duplicate"]
    assert send("e-1002", 300) == "accepted"
    assert send("e-1001", 999) == "conflict"  # same id, different data: refused, not overwritten

    usage = db.monthly_usage(conn, "t_shopkart", "2026-09")
    assert usage == {"api_calls": 800}  # not 1,800
    assert format_inr(build_invoice(STARTER, usage)["total_paise"]) == "₹499.00"


# ---------------------------------------------------------------- rules behind the cases

@pytest.mark.parametrize("units, price, expected", [
    (0, 2000, 0), (1, 1500, 2), (1, 499, 0), (1, 500, 1), (90_000, 2000, 180_000), (2_345, 2500, 5_863),
])
def test_line_amount_rounds_each_line_half_up(units, price, expected):
    assert line_amount(units, price) == expected


def test_zero_usage_gives_no_lines_and_only_the_base_fee():
    assert build_invoice(STARTER, {}) == {"plan_id": "starter", "base_fee_paise": 49_900, "lines": [],
                                          "total_paise": 49_900}


def test_units_fill_tiers_in_order_and_add_up():
    lines = price_tiers(250_000, STARTER["tiers"]["api_calls"])
    assert [l["units"] for l in lines] == [10_000, 90_000, 150_000]


def test_tier_labels():
    assert tier_label(1, 10_000) == "1 to 10,000"
    assert tier_label(100_001, None) == "100,001+"


@pytest.mark.parametrize("tiers, message", [
    ([], "at least one tier"),
    ([{"from": 2, "to": None, "per_1000": 0}], "should start at 1"),
    ([{"from": 1, "to": 100, "per_1000": 0}, {"from": 150, "to": None, "per_1000": 5}], "gap"),
    ([{"from": 1, "to": 100, "per_1000": 0}, {"from": 90, "to": None, "per_1000": 5}], "overlap"),
    ([{"from": 1, "to": None, "per_1000": 0}, {"from": 2, "to": None, "per_1000": 5}], "only the last tier"),
    ([{"from": 1, "to": 100, "per_1000": 0}], "must have no upper limit"),
    ([{"from": 1, "to": None, "per_1000": -1}], "price per 1,000"),
    ([{"from": 1, "to": None, "per_1000": 2.5}], "price per 1,000"),
])
def test_validate_tiers_rejects_bad_tiers(tiers, message):
    with pytest.raises(TierError, match=message):
        validate_tiers(tiers)


def test_sample_plans_have_valid_tiers():
    for plan in DATA["plans"]:
        for tiers in plan["tiers"].values():
            validate_tiers(tiers)


def test_usage_for_an_unpriced_meter_is_an_error():
    with pytest.raises(ValueError, match="no tiers for meter"):
        build_invoice({"id": "x", "base_fee_paise": 0, "tiers": {"api_calls": FREE["tiers"]["api_calls"]}},
                      {"emails_sent": 10})


@pytest.mark.parametrize("bad", [-1, 1.5, True])
def test_units_must_be_whole_and_non_negative(bad):
    with pytest.raises(ValueError):
        price_tiers(bad, FREE["tiers"]["api_calls"])


@pytest.mark.parametrize("paise, text", [(0, "₹0.00"), (5, "₹0.05"), (306_500, "₹3,065.00"),
                                         (12_345_678, "₹123,456.78"), (-250, "-₹2.50")])
def test_format_inr(paise, text):
    assert format_inr(paise) == text
