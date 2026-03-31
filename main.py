from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from dotenv import load_dotenv

from database import client
from db_utils import ensure_indexes
from routes.boq_routes import router as boq_router
from routes.invoice_routes import router as invoice_router
from routes.recce_routes import router as recce_router
from routes.request_routes import router as request_router
from routes.work_order_routes import router as work_order_router

load_dotenv()

APP_NAME = os.getenv("APP_NAME", "BrandFix Backend")
API_V1_PREFIX = os.getenv("API_V1_PREFIX", "/api/v1")


@asynccontextmanager
async def lifespan(_: FastAPI):
    client.admin.command("ping")
    ensure_indexes()
    yield
    client.close()


app = FastAPI(
    title=APP_NAME,
    version="1.0.0",
    description="Backend workflow service for the BrandFix B2B operations platform.",
    lifespan=lifespan,
)

app.include_router(request_router, prefix=API_V1_PREFIX)
app.include_router(recce_router, prefix=API_V1_PREFIX)
app.include_router(boq_router, prefix=API_V1_PREFIX)
app.include_router(work_order_router, prefix=API_V1_PREFIX)
app.include_router(invoice_router, prefix=API_V1_PREFIX)


@app.get("/")
async def root() -> dict[str, str]:
    return {"message": f"{APP_NAME} is running."}


@app.get("/health")
async def healthcheck() -> dict[str, Any]:
    client.admin.command("ping")
    return {"status": "ok", "service": APP_NAME}
