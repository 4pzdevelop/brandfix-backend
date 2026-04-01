from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import Field

from models.base_model import APIModel


class UserRole(str, Enum):
    ADMIN = 'ADMIN'
    CLIENT = 'CLIENT'
    FIELD = 'FIELD'
    FINANCE = 'FINANCE'


class UserBase(APIModel):
    email: str = Field(min_length=5, max_length=255)
    role: UserRole
    company_id: str = Field(min_length=1, max_length=120)


class UserResponse(UserBase):
    id: str
    created_at: datetime
    updated_at: datetime


class UserInDB(UserBase):
    password_hash: str
    created_at: datetime
    updated_at: datetime
