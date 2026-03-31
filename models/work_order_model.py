from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import Field

from models.base_model import APIModel


class WorkOrderStatus(str, Enum):
    created = "created"
    in_progress = "in_progress"
    completed = "completed"


class WorkOrderCreate(APIModel):
    request_id: str


class WorkOrderUpdate(APIModel):
    status: WorkOrderStatus | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    before_photos: list[str] | None = None
    after_photos: list[str] | None = None


class FinalReportCreate(APIModel):
    final_report_notes: str = Field(min_length=3, max_length=4000)
    final_report_files: list[str] = Field(default_factory=list)
    reported_at: datetime | None = None


class WorkOrderResponse(APIModel):
    id: str
    request_id: str
    boq_id: str
    status: WorkOrderStatus
    started_at: datetime | None = None
    completed_at: datetime | None = None
    before_photos: list[str] = Field(default_factory=list)
    after_photos: list[str] = Field(default_factory=list)
    final_report_notes: str | None = None
    final_report_files: list[str] = Field(default_factory=list)
    reported_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
