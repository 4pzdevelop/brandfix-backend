from __future__ import annotations

from pydantic import Field

from models.base_model import APIModel
from models.user_model import UserResponse

EMAIL_PATTERN = r'^[^@\s]+@[^@\s]+\.[^@\s]+$'


class LoginRequest(APIModel):
    email: str = Field(min_length=5, max_length=255, pattern=EMAIL_PATTERN)
    password: str = Field(min_length=8, max_length=128)


class RegisterRequest(APIModel):
    email: str = Field(min_length=5, max_length=255, pattern=EMAIL_PATTERN)
    password: str = Field(min_length=8, max_length=128)


class TokenResponse(APIModel):
    access_token: str
    token_type: str = 'bearer'
    expires_in: int
    user: UserResponse
