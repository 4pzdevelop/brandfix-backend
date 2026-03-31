from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import Field

from models.base_model import APIModel


class RequestStatus(str, Enum):
    request_created = "request_created"
    recce_completed = "recce_completed"
    boq_generated = "boq_generated"
    approved = "approved"
    work_order_created = "work_order_created"
    work_in_progress = "work_in_progress"
    final_report_submitted = "final_report_submitted"
    invoiced = "invoiced"
    cancelled = "cancelled"


class RequestBase(APIModel):
    company_name: str = Field(min_length=2, max_length=120)
    issue_title: str = Field(min_length=3, max_length=160)
    description: str = Field(min_length=5, max_length=5000)


class RequestCreate(RequestBase):
    pass


class RequestUpdate(APIModel):
    company_name: str | None = Field(default=None, min_length=2, max_length=120)
    issue_title: str | None = Field(default=None, min_length=3, max_length=160)
    description: str | None = Field(default=None, min_length=5, max_length=5000)
    status: RequestStatus | None = None


class RequestResponse(RequestBase):
    id: str
    status: RequestStatus
    recce_id: str | None = None
    boq_id: str | None = None
    work_order_id: str | None = None
    invoice_id: str | None = None
    created_at: datetime
    updated_at: datetime
