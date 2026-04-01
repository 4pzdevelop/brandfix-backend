from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI

from database import client
from db_utils import ensure_indexes
from middleware.auth_middleware import AuthMiddleware
from routes.auth_routes import router as auth_router
from routes.boq_routes import router as boq_router
from routes.invoice_routes import router as invoice_router
from routes.recce_routes import router as recce_router
from routes.requests_router import router as request_router
from routes.work_order_routes import router as work_order_router
from services.auth_service import ensure_bootstrap_admin

load_dotenv()

APP_NAME = os.getenv('APP_NAME', 'BrandFix Backend')
API_V1_PREFIX = os.getenv('API_V1_PREFIX', '/api/v1')


@asynccontextmanager
async def lifespan(_: FastAPI):
    client.admin.command('ping')
    ensure_indexes()
    ensure_bootstrap_admin()
    yield
    client.close()


app = FastAPI(
    title=APP_NAME,
    version='1.0.0',
    description='Backend workflow service for the BrandFix B2B operations platform.',
    lifespan=lifespan,
)

app.add_middleware(AuthMiddleware, api_prefix=API_V1_PREFIX)

app.include_router(auth_router, prefix=API_V1_PREFIX)
app.include_router(request_router, prefix=API_V1_PREFIX)
app.include_router(recce_router, prefix=API_V1_PREFIX)
app.include_router(boq_router, prefix=API_V1_PREFIX)
app.include_router(work_order_router, prefix=API_V1_PREFIX)
app.include_router(invoice_router, prefix=API_V1_PREFIX)


@app.get(API_V1_PREFIX)
async def api_root() -> dict[str, Any]:
    return {'data': {'message': f'{APP_NAME} is running.'}}


@app.get(f'{API_V1_PREFIX}/health')
async def healthcheck() -> dict[str, Any]:
    client.admin.command('ping')
    return {'data': {'status': 'ok', 'service': APP_NAME}}
