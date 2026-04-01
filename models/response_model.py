from __future__ import annotations

from typing import Generic, TypeVar

from models.base_model import APIModel


DataT = TypeVar('DataT')


class DataResponse(APIModel, Generic[DataT]):
    data: DataT
