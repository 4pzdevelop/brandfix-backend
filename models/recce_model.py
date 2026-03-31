from __future__ import annotations

from datetime import datetime

from pydantic import Field

from models.base_model import APIModel
from models.recce_item_model import RecceItem


class RecceBase(APIModel):
    request_id: str
    store_name: str = Field(min_length=2, max_length=160)
    overall_notes: str | None = Field(default=None, max_length=4000)
    items: list[RecceItem] = Field(min_length=1)


class RecceCreate(RecceBase):
    pass


class RecceUpdate(APIModel):
    store_name: str | None = Field(default=None, min_length=2, max_length=160)
    overall_notes: str | None = Field(default=None, max_length=4000)
    items: list[RecceItem] | None = Field(default=None, min_length=1)


class RecceResponse(RecceBase):
    id: str
    created_at: datetime
    updated_at: datetime
