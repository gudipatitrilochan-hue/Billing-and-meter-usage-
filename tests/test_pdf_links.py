"""PDF links: upload a PDF, get a link, and ₹20 per PDF lands on the bill."""
import importlib
import json
from pathlib import Path

import pytest

from app.pricing import build_invoice, format_inr

DATA = json.loads((Path(__file__).resolve().parent.parent / "data" / "sample-data.json").read_text())
PLANS = {p["id"]: p for p in DATA["plans"]}
PDF = b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"


# ---------------------------------------------------------------- pricing (no server)

@pytest.mark.parametrize("plan", ["free", "starter", "growth"])
def test_every_plan_charges_20_rupees_per_pdf(plan):
    one = build_invoice(PLANS[plan], {"pdf_links": 1})
    none = build_invoice(PLANS[plan], {})
    assert one["total_paise"] - none["total_paise"] == 2_000


def test_c7_three_pdfs_on_starter():
    inv = build_invoice(PLANS["starter"], {"pdf_links": 3})
    assert [(l["meter_id"], l["units"], l["amount_paise"]) for l in inv["lines"]] == [("pdf_links", 3, 6_000)]
    assert format_inr(inv["total_paise"]) == "₹559.00"            # ₹499 base + 3 × ₹20


def test_pdfs_add_on_top_of_the_c1_bill():
    inv = build_invoice(PLANS["starter"], {"api_calls": 135_400, "emails_sent": 2_350, "pdf_links": 3})
    assert format_inr(inv["total_paise"]) == "₹3,125.00"          # C1 ₹3,065 + ₹60


# ---------------------------------------------------------------- the API

@pytest.fixture()
def api(tmp_path, monkeypatch):
    """A seeded database and an empty uploads folder, both in tmp_path."""
    from fastapi.testclient import TestClient

    monkeypatch.setenv("METERLEDGER_DB", str(tmp_path / "test.db"))
    monkeypatch.setenv("METERLEDGER_UPLOADS", str(tmp_path / "uploads"))
    monkeypatch.setenv("ADMIN_KEY", "admin-test-key")
    seed = importlib.import_module("scripts.seed")
    from app import db
    with db.connect() as conn:
        db.init_schema(conn)
        keys = seed.load_catalog(conn, DATA)
    from app.main import app
    with TestClient(app) as client:
        client.keys = keys
        client.uploads = tmp_path / "uploads"
        yield client


def upload(api, key, data=PDF, name="report.pdf", idem=None):
    headers = {"X-Api-Key": key}
    if idem:
        headers["Idempotency-Key"] = idem
    return api.post("/api/pdfs", headers=headers, files={"file": (name, data, "application/pdf")})


def test_upload_returns_a_link_that_opens_the_pdf(api):
    r = upload(api, api.keys["t_shopkart"])
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "accepted" and body["charged_paise"] == 2_000
    assert body["link"].startswith("http://testserver/p/") and body["filename"] == "report.pdf"
    opened = api.get(body["link"].replace("http://testserver", ""))
    assert opened.status_code == 200
    assert opened.headers["content-type"] == "application/pdf"
    assert opened.content == PDF


def test_each_pdf_adds_20_rupees_to_the_estimate(api):
    key = api.keys["t_tinybot"]                                     # Free plan, no other usage
    for i in range(3):
        upload(api, key, name=f"doc{i}.pdf")
    est = api.get("/api/usage/estimate", headers={"X-Api-Key": key}).json()
    assert est["total_paise"] == 6_000
    assert [(l["meter_id"], l["units"], l["amount_paise"]) for l in est["lines"]] == [("pdf_links", 3, 6_000)]
    assert api.get("/api/usage", headers={"X-Api-Key": key}).json()["meters"]["pdf_links"] == 3
    assert len(api.get("/api/pdfs", headers={"X-Api-Key": key}).json()) == 3


def test_a_retried_upload_is_charged_once(api):
    key = api.keys["t_shopkart"]
    first = upload(api, key, idem="upload-0001")
    again = upload(api, key, idem="upload-0001")
    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json()["status"] == "duplicate" and again.json()["charged_paise"] == 0
    assert again.json()["link"] == first.json()["link"]
    assert api.get("/api/usage", headers={"X-Api-Key": key}).json()["meters"]["pdf_links"] == 1
    assert len(list(api.uploads.glob("*.pdf"))) == 1


def test_non_pdf_too_big_and_empty_files_are_rejected_and_not_charged(api):
    key = api.keys["t_shopkart"]
    assert upload(api, key, data=b"hello", name="a.txt").json()["error"] == "not_a_pdf"
    assert upload(api, key, data=b"", name="empty.pdf").json()["error"] == "empty_file"
    big = upload(api, key, data=PDF + b"0" * (10 * 1024 * 1024))
    assert (big.status_code, big.json()["error"]) == (413, "file_too_large")
    assert api.get("/api/usage", headers={"X-Api-Key": key}).json()["meters"]["pdf_links"] == 0
    assert not list(api.uploads.glob("*"))


def test_keys_are_required_and_tenants_only_see_their_own_pdfs(api):
    assert api.post("/api/pdfs", files={"file": ("a.pdf", PDF, "application/pdf")}).json()["error"] == "missing_key"
    assert upload(api, "ml_wrong").status_code == 401
    upload(api, api.keys["t_shopkart"])
    assert api.get("/api/pdfs", headers={"X-Api-Key": api.keys["t_tinybot"]}).json() == []


def test_unknown_and_malformed_links_are_404(api):
    assert api.get("/p/doesnotexist_doesnotexist").status_code == 404
    assert api.get("/p/..%2F..%2Fapp%2Fmain.py").status_code == 404


def test_unsafe_filenames_are_cleaned(api):
    body = upload(api, api.keys["t_shopkart"], name="../../etc/<passwd>").json()
    assert body["filename"] == "_passwd_.pdf"
