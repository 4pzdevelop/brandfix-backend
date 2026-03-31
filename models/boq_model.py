from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import Field

from models.base_model import APIModel
from models.boq_item_model import BoqItem, BoqItemUpdate


class ApprovalStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class BoqCreate(APIModel):
    request_id: str
    default_rate: float = Field(default=0, ge=0)


class BoqUpdate(APIModel):
    items: list[BoqItemUpdate] | None = Field(default=None, min_length=1)
    approval_notes: str | None = Field(default=None, max_length=2000)


class BoqApprovalAction(APIModel):
    approved_by: str | None = Field(default=None, max_length=120)
    approval_notes: str | None = Field(default=None, max_length=2000)


class BoqRejectionAction(APIModel):
    approval_notes: str = Field(min_length=3, max_length=2000)


class BoqResponse(APIModel):
    id: str
    request_id: str
    recce_id: str
    items: list[BoqItem]
    subtotal: float
    cgst: float
    sgst: float
    grand_total: float
    approval_status: ApprovalStatus
    approval_notes: str | None = None
    approved_by: str | None = None
    approved_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
