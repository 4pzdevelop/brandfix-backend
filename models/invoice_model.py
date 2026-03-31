from __future__ import annotations

from datetime import date, datetime

from pydantic import Field

from models.base_model import APIModel


class InvoiceCreate(APIModel):
    request_id: str
    invoice_no: str | None = Field(default=None, max_length=64)
    invoice_date: date | None = None


class InvoiceUpdate(APIModel):
    invoice_no: str | None = Field(default=None, max_length=64)
    invoice_date: date | None = None


class InvoiceResponse(APIModel):
    id: str
    request_id: str
    boq_id: str
    work_order_id: str
    invoice_no: str
    invoice_date: date
    taxable_amount: float
    cgst: float
    sgst: float
    grand_total: float
    created_at: datetime
    updated_at: datetime
