from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, status

from middleware.auth_middleware import get_current_user
from models.auth_model import LoginRequest, TokenResponse
from models.response_model import DataResponse
from models.user_model import UserResponse
from services.auth_service import authenticate_user, create_access_token, serialize_user_document


router = APIRouter(prefix='/auth', tags=['Auth'])


@router.post('/login', response_model=DataResponse[TokenResponse], status_code=status.HTTP_200_OK)
def login(payload: LoginRequest) -> dict[str, Any]:
    user = authenticate_user(payload.email, payload.password)
    access_token, expires_in = create_access_token(user)

    return {
        'data': {
            'access_token': access_token,
            'token_type': 'bearer',
            'expires_in': expires_in,
            'user': serialize_user_document(user),
        }
    }


@router.get('/me', response_model=DataResponse[UserResponse])
def get_me(request: Request) -> dict[str, Any]:
    current_user = get_current_user(request)
    return {'data': current_user}
