from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response, status

from db_utils import (
    get_collection,
    get_request_or_404,
    parse_object_id,
    serialize_document,
)
from models.request_model import RequestCreate, RequestResponse, RequestStatus, RequestUpdate
from services.notification_service import publish_workflow_event


router = APIRouter(prefix="/requests", tags=["Requests"])


@router.post("", response_model=RequestResponse, status_code=status.HTTP_201_CREATED)
def create_request(payload: RequestCreate) -> dict[str, Any]:
    now = datetime.now(UTC)
    document = {
        **payload.model_dump(),
        "status": RequestStatus.request_created.value,
        "recce_id": None,
        "boq_id": None,
        "work_order_id": None,
        "invoice_id": None,
        "created_at": now,
        "updated_at": now,
    }
    result = get_collection("requests").insert_one(document)
    document["_id"] = result.inserted_id

    request_id = str(result.inserted_id)
    publish_workflow_event("request", "created", request_id, {"status": document["status"]})
    return serialize_document(document)


@router.get("", response_model=list[RequestResponse])
def list_requests(
    status_filter: RequestStatus | None = Query(default=None, alias="status"),
    company_name: str | None = Query(default=None, alias="companyName"),
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if status_filter:
        query["status"] = status_filter.value
    if company_name:
        query["company_name"] = {"$regex": company_name, "$options": "i"}

    cursor = get_collection("requests").find(query).sort("created_at", -1)
    return [serialize_document(document) for document in cursor]


@router.get("/{request_id}", response_model=RequestResponse)
def get_request(request_id: str) -> dict[str, Any]:
    request = get_request_or_404(request_id)
    return serialize_document(request)


@router.get("/{request_id}/workflow")
def get_request_workflow(request_id: str) -> dict[str, Any]:
    request = get_request_or_404(request_id)
    request_object_id = parse_object_id(request_id, "request")

    recce = get_collection("recce").find_one({"request_id": request_object_id})
    boq = get_collection("boq").find_one({"request_id": request_object_id})
    work_order = get_collection("work_orders").find_one({"request_id": request_object_id})
    invoice = get_collection("invoices").find_one({"request_id": request_object_id})

    return {
        "request": serialize_document(request),
        "recce": serialize_document(recce),
        "boq": serialize_document(boq),
        "work_order": serialize_document(work_order),
        "invoice": serialize_document(invoice),
    }


@router.put("/{request_id}", response_model=RequestResponse)
def update_request(request_id: str, payload: RequestUpdate) -> dict[str, Any]:
    get_request_or_404(request_id)
    update_fields = payload.model_dump(exclude_none=True)
    if not update_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one field is required for update.",
        )

    update_fields["updated_at"] = datetime.now(UTC)
    get_collection("requests").update_one(
        {"_id": parse_object_id(request_id, "request")},
        {"$set": update_fields},
    )

    updated_request = get_request_or_404(request_id)
    publish_workflow_event("request", "updated", request_id, update_fields)
    return serialize_document(updated_request)


@router.delete("/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_request(request_id: str) -> Response:
    get_request_or_404(request_id)
    request_object_id = parse_object_id(request_id, "request")

    get_collection("recce").delete_many({"request_id": request_object_id})
    get_collection("boq").delete_many({"request_id": request_object_id})
    get_collection("work_orders").delete_many({"request_id": request_object_id})
    get_collection("invoices").delete_many({"request_id": request_object_id})
    get_collection("requests").delete_one({"_id": request_object_id})

    publish_workflow_event("request", "deleted", request_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
