from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, Response, status

from db_utils import (
    build_company_scoped_query,
    get_company_scoped_document_or_404,
    get_company_scoped_request_or_404,
    get_collection,
    parse_object_id,
    serialize_document,
    sync_request_workflow_state,
)
from middleware.auth_middleware import get_current_user, require_roles
from models.recce_model import RecceCreate, RecceResponse, RecceUpdate
from models.user_model import UserRole
from services.notification_service import publish_workflow_event


router = APIRouter(prefix="/recce", tags=["Recce"])


@router.post("", response_model=RecceResponse, status_code=status.HTTP_201_CREATED)
def create_recce(payload: RecceCreate, request: Request) -> dict[str, Any]:
    current_user = get_current_user(request)
    require_roles(current_user, UserRole.ADMIN, UserRole.FIELD)
    request_document = get_company_scoped_request_or_404(payload.request_id, current_user['company_id'])
    request_object_id = request_document['_id']

    existing_recce = get_collection("recce").find_one({"request_id": request_object_id})
    if existing_recce:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A recce already exists for this request.",
        )

    now = datetime.now(UTC)
    document = {
        **payload.model_dump(),
        "request_id": request_object_id,
        "created_at": now,
        "updated_at": now,
    }
    result = get_collection("recce").insert_one(document)
    document["_id"] = result.inserted_id

    sync_request_workflow_state(payload.request_id)
    publish_workflow_event("recce", "created", payload.request_id, {"recce_id": str(result.inserted_id)})
    return serialize_document(document)


@router.get("", response_model=list[RecceResponse])
def list_recce(
    request: Request,
    request_id: str | None = Query(default=None, alias="requestId"),
) -> list[dict[str, Any]]:
    current_user = get_current_user(request)
    query = build_company_scoped_query(current_user['company_id'], request_id)
    cursor = get_collection("recce").find(query).sort("created_at", -1)
    return [serialize_document(document) for document in cursor]


@router.get("/{recce_id}", response_model=RecceResponse)
def get_recce(recce_id: str, request: Request) -> dict[str, Any]:
    current_user = get_current_user(request)
    recce = get_company_scoped_document_or_404('recce', recce_id, 'recce', current_user['company_id'])
    return serialize_document(recce)


@router.put("/{recce_id}", response_model=RecceResponse)
def update_recce(recce_id: str, payload: RecceUpdate, request: Request) -> dict[str, Any]:
    current_user = get_current_user(request)
    require_roles(current_user, UserRole.ADMIN, UserRole.FIELD)
    recce = get_company_scoped_document_or_404('recce', recce_id, 'recce', current_user['company_id'])
    request_id = str(recce["request_id"])

    existing_boq = get_collection("boq").find_one({"request_id": recce["request_id"]})
    if existing_boq:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Recce cannot be changed after BOQ creation. Delete the BOQ first if the inspection has changed.",
        )

    update_fields = payload.model_dump(exclude_none=True)
    if not update_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one field is required for update.",
        )

    update_fields["updated_at"] = datetime.now(UTC)
    get_collection("recce").update_one(
        {"_id": recce["_id"]},
        {"$set": update_fields},
    )

    updated_recce = get_company_scoped_document_or_404('recce', recce_id, 'recce', current_user['company_id'])
    sync_request_workflow_state(request_id)
    publish_workflow_event("recce", "updated", request_id, {"recce_id": recce_id})
    return serialize_document(updated_recce)


@router.delete("/{recce_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recce(recce_id: str, request: Request) -> Response:
    current_user = get_current_user(request)
    require_roles(current_user, UserRole.ADMIN, UserRole.FIELD)
    recce = get_company_scoped_document_or_404('recce', recce_id, 'recce', current_user['company_id'])
    request_id = str(recce["request_id"])

    get_collection("invoices").delete_many({"request_id": recce["request_id"]})
    get_collection("work_orders").delete_many({"request_id": recce["request_id"]})
    get_collection("boq").delete_many({"request_id": recce["request_id"]})
    get_collection("recce").delete_one({"_id": recce["_id"]})

    sync_request_workflow_state(request_id)
    publish_workflow_event("recce", "deleted", request_id, {"recce_id": recce_id})
    return Response(status_code=status.HTTP_204_NO_CONTENT)
