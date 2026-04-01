from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from typing import Any

from dotenv import load_dotenv
from fastapi import HTTPException, status
from jose import JWTError, jwt
from passlib.context import CryptContext

from database import db
from db_utils import parse_object_id, serialize_document
from models.user_model import UserRole

load_dotenv()

JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY')
JWT_ALGORITHM = os.getenv('JWT_ALGORITHM', 'HS256')
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv('ACCESS_TOKEN_EXPIRE_MINUTES', '60'))

if not JWT_SECRET_KEY:
    raise RuntimeError('JWT_SECRET_KEY must be configured in the environment.')

pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')
users_collection = db['users']


def normalize_email(email: str) -> str:
    return email.strip().lower()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def serialize_user_document(document: dict[str, Any]) -> dict[str, Any]:
    serialized = serialize_document(document)
    if serialized is None:
        return {}
    serialized.pop('password_hash', None)
    return serialized


def get_user_by_email(email: str) -> dict[str, Any] | None:
    return users_collection.find_one({'email': normalize_email(email)})


def get_user_by_id(user_id: str) -> dict[str, Any] | None:
    return users_collection.find_one({'_id': parse_object_id(user_id, 'user')})


def authenticate_user(email: str, password: str) -> dict[str, Any]:
    user = get_user_by_email(email)
    if user is None or not verify_password(password, user['password_hash']):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Invalid email or password.',
        )
    return user


def create_access_token(user: dict[str, Any]) -> tuple[str, int]:
    expires_delta = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    expires_at = datetime.now(UTC) + expires_delta
    payload = {
        'sub': str(user['_id']),
        'userId': str(user['_id']),
        'role': user['role'],
        'companyId': user['company_id'],
        'exp': expires_at,
    }
    token = jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    return token, int(expires_delta.total_seconds())


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Invalid or expired token.',
        ) from exc

    required_fields = ('userId', 'role', 'companyId')
    if any(field not in payload for field in required_fields):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Token payload is incomplete.',
        )

    return payload


def ensure_bootstrap_admin() -> None:
    email = os.getenv('BOOTSTRAP_ADMIN_EMAIL')
    password = os.getenv('BOOTSTRAP_ADMIN_PASSWORD')
    company_id = os.getenv('BOOTSTRAP_ADMIN_COMPANY_ID')

    if not all([email, password, company_id]):
        return

    normalized_email = normalize_email(email)
    existing_user = users_collection.find_one({'email': normalized_email})
    if existing_user:
        return

    now = datetime.now(UTC)
    users_collection.insert_one(
        {
            'email': normalized_email,
            'password_hash': hash_password(password),
            'role': UserRole.ADMIN.value,
            'company_id': company_id,
            'created_at': now,
            'updated_at': now,
        }
    )
