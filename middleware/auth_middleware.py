from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from models.user_model import UserRole
from services.auth_service import decode_access_token, get_user_by_id, serialize_user_document


class AuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: Any, api_prefix: str = '/api/v1') -> None:
        super().__init__(app)
        self.api_prefix = api_prefix.rstrip('/')
        self.public_paths = {
            self.api_prefix,
            f'{self.api_prefix}/health',
            f'{self.api_prefix}/auth/register',
            f'{self.api_prefix}/auth/login',
        }

    async def dispatch(self, request: Request, call_next):
        request.state.user = None
        path = normalize_path(request.url.path)

        if not path.startswith(self.api_prefix):
            return await call_next(request)

        auth_header = request.headers.get('Authorization')
        is_public_path = path in self.public_paths

        if not auth_header:
            if is_public_path:
                return await call_next(request)
            return JSONResponse({'detail': 'Authentication required.'}, status_code=status.HTTP_401_UNAUTHORIZED)

        scheme, _, token = auth_header.partition(' ')
        if scheme.lower() != 'bearer' or not token:
            return JSONResponse(
                {'detail': 'Invalid authorization header.'},
                status_code=status.HTTP_401_UNAUTHORIZED,
            )

        try:
            payload = decode_access_token(token)
            user = get_user_by_id(payload['userId'])
            if user is None:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail='Authenticated user was not found.',
                )
            request.state.user = serialize_user_document(user)
        except HTTPException as exc:
            return JSONResponse({'detail': exc.detail}, status_code=exc.status_code)

        return await call_next(request)


def normalize_path(path: str) -> str:
    if path == '/':
        return path
    return path.rstrip('/')


def get_current_user(request: Request) -> dict[str, Any]:
    user = getattr(request.state, 'user', None)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Authentication required.',
        )
    return user


def require_roles(current_user: dict[str, Any], *roles: UserRole) -> None:
    allowed_roles = {role.value for role in roles}
    if current_user['role'] not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='You do not have permission to perform this action.',
        )
