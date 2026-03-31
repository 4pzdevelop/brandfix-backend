from __future__ import annotations

from pydantic import Field

from models.base_model import APIModel


class BoqItem(APIModel):
    line_id: str
    title: str = Field(min_length=2, max_length=160)
    element_type: str = Field(min_length=2, max_length=100)
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    depth: float = Field(default=0, ge=0)
    quantity: int = Field(gt=0)
    rate: float = Field(default=0, ge=0)
    area: float = Field(ge=0)
    item_total: float = Field(ge=0)
    remarks: str | None = Field(default=None, max_length=2000)
    images: list[str] = Field(default_factory=list)


class BoqItemUpdate(APIModel):
    line_id: str
    quantity: int | None = Field(default=None, gt=0)
    rate: float | None = Field(default=None, ge=0)
