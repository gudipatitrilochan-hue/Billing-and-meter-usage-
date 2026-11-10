"""Week 1 checkpoint: the seed loads the CSV once per event and the totals match C1 and C2."""
import hashlib
import sqlite3

import pytest

from app import db
from app.pricing import build_invoice, format_inr
from scripts import seed


@pytest.fixture()
def seeded(tmp_path, monkeypatch, capsys):
    path = tmp_path / "seed.db"
    monkeypatch.setenv("METERLEDGER_DB", str(path))
    seed.main([])
    out = capsys.readouterr().out
    conn = db.connect(path)
    yield conn, out
    conn.close()


def test_seed_totals_match_c1_and_c2(seeded):
    conn, _ = seeded
    shopkart = db.monthly_usage(conn, "t_shopkart", "2026-09")
    assert shopkart == {"api_calls": 135_400, "emails_sent": 2_350}
    assert format_inr(build_invoice(db.load_plan(conn, "starter"), shopkart)["total_paise"]) == "₹3,065.00"
    tinybot = db.monthly_usage(conn, "t_tinybot", "2026-09")
    assert tinybot == {"api_calls": 8_200}
    assert format_inr(build_invoice(db.load_plan(conn, "free"), tinybot)["total_paise"]) == "₹0.00"


def test_csv_retries_are_stored_once(seeded):
    conn, out = seeded
    rows = conn.execute("SELECT COUNT(*), COUNT(DISTINCT tenant_id || '/' || event_id) FROM usage_events").fetchone()
    assert rows[0] == rows[1]
    assert "duplicates skipped" in out and "conflicts 0" in out
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO usage_events (tenant_id, event_id, meter_id, quantity, occurred_at, period,"
                     " received_at) VALUES ('t_shopkart', 'shk-2026-09-01-0001', 'api_calls', 1,"
                     " '2026-09-01T04:51:10Z', '2026-09', '2026-09-01T04:51:10Z')")


def test_only_key_hashes_are_stored(seeded):
    conn, out = seeded
    for row in conn.execute("SELECT id, api_key_hash, key_prefix FROM tenants"):
        printed = next(line.split()[1] for line in out.splitlines() if line.strip().startswith(row["id"] + " "))
        assert row["api_key_hash"] == hashlib.sha256(printed.encode()).hexdigest()
        assert row["key_prefix"] == printed[:8]
        assert printed not in row["api_key_hash"]


def test_totals_are_printed_per_tenant(seeded):
    _, out = seeded
    for name in ("ShopKart", "TinyBot", "PayNest", "QuickCab", "MediMinder", "Lumen Labs"):
        assert name in out
    assert "₹3,065.00" in out
