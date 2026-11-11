"""MeterLedger API server (FastAPI).

    uvicorn app.main:app --reload        # http://localhost:8000  (console at /, API docs at /docs)

Serves the console from app/static, the JSON API under /api, and stored PDFs at /p/{token}.
This first slice covers the PDF links feature and the routes its page needs: /me, /usage,
/usage/estimate, /pdfs. The rest of PRD Section 9 (events, batch, invoices) follows in Week 2–3.
"""
from __future__ import annotations

import re
import sqlite3
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Iterator

from fastapi import Depends, FastAPI, File, Header, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import db, pdf_links
from app.auth import AuthError, is_admin, tenant_for_key
from app.pricing import METERS

STATIC = Path(__file__).with_name("static")
PERIOD_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")



@asynccontextmanager
async def lifespan(_: FastAPI):
    path = db.db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with db.connect(path) as conn:      # CREATE TABLE IF NOT EXISTS: safe on an existing database
        db.init_schema(conn)
    yield


app = FastAPI(title="MeterLedger API", version="0.2.0", lifespan=lifespan,
              description="Usage metering and billing. PDF links are billed at ₹20 per PDF.")


class ApiError(Exception):
    def __init__(self, status: int, error: str, detail: str):
        self.status, self.error, self.detail = status, error, detail


@app.exception_handler(ApiError)
@app.exception_handler(AuthError)
@app.exception_handler(pdf_links.PdfError)
async def api_error(_: Request, exc):  # every error is {"error", "detail"} (PRD Section 12)
    return JSONResponse({"error": exc.error, "detail": exc.detail}, status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    detail = "; ".join(f"{'.'.join(map(str, e['loc'][1:]))}: {e['msg']}" for e in exc.errors())
    return JSONResponse({"error": "invalid_request", "detail": detail}, status_code=400)


def get_conn() -> Iterator[sqlite3.Connection]:
    conn = db.connect(any_thread=True)
    try:
        yield conn
    finally:
        conn.close()


def current_tenant(conn: sqlite3.Connection = Depends(get_conn),
                   x_api_key: str | None = Header(default=None)) -> sqlite3.Row:
    return tenant_for_key(conn, x_api_key)


def check_period(period: str | None) -> str:
    if period is None:
        return db.period_of(db.utc_now())
    if not PERIOD_RE.match(period):
        raise ApiError(400, "bad_period", "period must look like 2026-09")
    return period


def base_url(request: Request) -> str:
    return str(request.base_url).rstrip("/")


# ---------------------------------------------------------------- API

@app.get("/api/me", tags=["auth"])
def me(conn: sqlite3.Connection = Depends(get_conn), x_api_key: str | None = Header(default=None),
       x_admin_key: str | None = Header(default=None)):
    if x_admin_key and is_admin(x_admin_key):
        return {"role": "admin"}
    t = tenant_for_key(conn, x_api_key)
    plan = db.load_plan(conn, t["plan_id"])
    return {"role": "tenant", "tenant": {
        "id": t["id"], "name": t["name"], "plan_id": t["plan_id"], "status": t["status"],
        "created_at": t["created_at"], "key_prefix": t["key_prefix"], "key_masked": f"{t['key_prefix']}…",
        "plan": plan}}


@app.get("/api/usage", tags=["usage"])
def usage(period: str | None = None, tenant=Depends(current_tenant), conn=Depends(get_conn)):
    p = check_period(period)
    totals = db.monthly_usage(conn, tenant["id"], p)
    return {"tenant_id": tenant["id"], "period": p, "meters": {m: totals.get(m, 0) for m in METERS}}


@app.get("/api/usage/estimate", tags=["usage"])
def usage_estimate(period: str | None = None, tenant=Depends(current_tenant), conn=Depends(get_conn)):
    p = check_period(period)
    plan = db.load_plan(conn, tenant["plan_id"])
    inv = pdf_links.estimate(conn, tenant, p)
    return {"tenant_id": tenant["id"], "period": p, "plan_id": plan["id"], "plan_name": plan["name"],
            "usage": db.monthly_usage(conn, tenant["id"], p), "base_fee_paise": inv["base_fee_paise"],
            "total_paise": inv["total_paise"], "saved": False,
            "lines": [{k: l[k] for k in ("meter_id", "tier_label", "units", "price_per_1000_paise", "amount_paise")}
                      for l in inv["lines"]]}


@app.get("/api/usage/daily", tags=["usage"])
def usage_daily(period: str | None = None, meter: str = "api_calls", tenant=Depends(current_tenant),
                conn=Depends(get_conn)):
    p = check_period(period)
    if meter not in METERS:
        raise ApiError(400, "unknown_meter", f"meter must be one of {', '.join(METERS)}")
    totals = dict(conn.execute(
        "SELECT substr(occurred_at, 1, 10), SUM(quantity) FROM usage_events"
        " WHERE tenant_id = ? AND period = ? AND meter_id = ? GROUP BY 1", (tenant["id"], p, meter)).fetchall())
    year, month = map(int, p.split("-"))
    days = (date(year + month // 12, month % 12 + 1, 1) - date(year, month, 1)).days
    return [{"day": f"{p}-{d:02d}", "quantity": totals.get(f"{p}-{d:02d}", 0)} for d in range(1, days + 1)]


@app.get("/api/plans", tags=["plans"], summary="The price list (public)")
def list_plans(conn=Depends(get_conn)):
    ids = [r["id"] for r in conn.execute("SELECT id FROM plans WHERE active = 1 ORDER BY base_fee_paise")]
    return [{**db.load_plan(conn, i), "currency": "INR", "active": True, "locked": False} for i in ids]


@app.get("/api/invoices", tags=["invoices"], summary="My invoices (generated from Week 3)")
def list_invoices(tenant=Depends(current_tenant), conn=Depends(get_conn)):
    rows = conn.execute("SELECT id, number, tenant_id, period, plan_id, status, base_fee_paise, total_paise,"
                        " created_at FROM invoices WHERE tenant_id = ? ORDER BY period DESC", (tenant["id"],))
    return [dict(r) for r in rows]


@app.post("/api/pdfs", tags=["pdf links"], status_code=201,
          summary="Upload a PDF, get a link, and add ₹20 to this month's bill")
async def upload_pdf(request: Request, file: UploadFile = File(...), tenant=Depends(current_tenant),
                     conn=Depends(get_conn), idempotency_key: str | None = Header(default=None)):
    data = await file.read(pdf_links.MAX_PDF_BYTES + 1)
    status, body = pdf_links.create(conn, tenant, file.filename, data, idempotency_key, base_url(request))
    return JSONResponse(body, status_code=status)


@app.get("/api/pdfs", tags=["pdf links"], summary="List my PDF links")
def list_pdfs(request: Request, period: str | None = None, tenant=Depends(current_tenant), conn=Depends(get_conn)):
    p = check_period(period) if period else None
    return pdf_links.list_for(conn, tenant["id"], p, base_url(request))


# ---------------------------------------------------------------- public link

@app.get("/p/{token}", tags=["pdf links"], summary="Open a shared PDF")
def open_pdf(token: str, conn=Depends(get_conn)):
    path = pdf_links.file_for(token)
    row = conn.execute("SELECT filename FROM pdf_links WHERE token = ?", (token,)).fetchone() if path else None
    if row is None or not path.exists():
        raise ApiError(404, "not_found", "This link doesn't exist")
    return FileResponse(path, media_type="application/pdf", content_disposition_type="inline",
                        filename=row["filename"],
                        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"})


@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"], include_in_schema=False)
def not_built_yet(rest: str):
    raise ApiError(404, "not_found", f"/api/{rest} isn't on the server yet (PRD Week 2–3)")


# The console. Mounted last so the API routes above win.
app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
