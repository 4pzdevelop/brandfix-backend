from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, Response, status

from db_utils import (
    build_company_scoped_query,
    get_company_scoped_document_or_404,
    get_company_scoped_request_or_404,
    get_collection,
    serialize_document,
    sync_request_workflow_state,
)
from middleware.auth_middleware import get_current_user, require_roles
from models.boq_model import (
    BoqApprovalAction,
    BoqCreate,
    BoqRejectionAction,
    BoqResponse,
    BoqUpdate,
)
from models.user_model import UserRole
from services.calculation_service import build_boq_items, recalculate_boq
from services.notification_service import publish_workflow_event


router = APIRouter(prefix="/boq", tags=["BOQ"])


def merge_boq_item_updates(
    existing_items: list[dict[str, Any]],
    updates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    updates_by_line_id = {update["line_id"]: update for update in updates}
    seen_line_ids: set[str] = set()
    next_items: list[dict[str, Any]] = []

    for item in existing_items:
        line_id = item["line_id"]
        if line_id not in updates_by_line_id:
            next_items.append(item)
            continue

        seen_line_ids.add(line_id)
        merged_item = dict(item)
        for key in ("quantity", "rate"):
            if key in updates_by_line_id[line_id]:
                merged_item[key] = updates_by_line_id[line_id][key]
        next_items.append(merged_item)

    missing_line_ids = sorted(set(updates_by_line_id) - seen_line_ids)
    if missing_line_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown BOQ line ids: {', '.join(missing_line_ids)}.",
        )

    return next_items


@router.post("", response_model=BoqResponse, status_code=status.HTTP_201_CREATED)
def create_boq(payload: BoqCreate, request: Request) -> dict[str, Any]:
    current_user = get_current_user(request)
    require_roles(current_user, UserRole.ADMIN)
    request_document = get_company_scoped_request_or_404(payload.request_id, current_user['company_id'])
    request_object_id = request_document['_id']

    recce = get_collection("recce").find_one({"request_id": request_object_id})
    if recce is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Create the recce before generating the BOQ.",
        )

    existing_boq = get_collection("boq").find_one({"request_id": request_object_id})
    if existing_boq:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A BOQ already exists for this request.",
        )

    boq_items = build_boq_items(recce["items"], default_rate=payload.default_rate)
    totals = recalculate_boq(boq_items)
    now = datetime.now(UTC)
    document = {
        "request_id": request_object_id,
        "recce_id": recce["_id"],
        "items": totals["items"],
        "subtotal": totals["subtotal"],
        "cgst": totals["cgst"],
        "sgst": totals["sgst"],
        "grand_total": totals["grand_total"],
        "approval_status": "pending",
        "approval_notes": None,
        "approved_by": None,
        "approved_at": None,
        "created_at": now,
        "updated_at": now,
    }
    result = get_collection("boq").insert_one(document)
    document["_id"] = result.inserted_id

    sync_request_workflow_state(payload.request_id)
    publish_workflow_event("boq", "created", payload.request_id, {"boq_id": str(result.inserted_id)})
    return serialize_document(document)


@router.get("", response_model=list[BoqResponse])
def list_boq(
    request: Request,
    request_id: str | None = Query(default=None, alias="requestId"),
) -> list[dict[str, Any]]:
    current_user = get_current_user(request)
    query = build_company_scoped_query(current_user['company_id'], request_id)
    cursor = get_collection("boq").find(query).sort("created_at", -1)
    return [serialize_document(document) for document in cursor]


@router.get("/{boq_id}", response_model=BoqResponse)
def get_boq(boq_id: str, request: Request) -> dict[str, Any]:
    current_user = get_current_user(request)
    boq = get_company_scoped_document_or_404('boq', boq_id, 'boq', current_user['company_id'])
    return serialize_document(boq)


@router.put("/{boq_id}", response_model=BoqResponse)
def update_boq(boq_id: str, payload: BoqUpdate, request: Request) -> dict[str, Any]:
    current_user = get_current_user(request)
    require_roles(current_user, UserRole.ADMIN)
    boq = get_company_scoped_document_or_404('boq', boq_id, 'boq', current_user['company_id'])
    request_id = str(boq["request_id"])

    update_fields = payload.model_dump(exclude_none=True)
    if not update_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one field is required for update.",
        )

    has_item_updates = "items" in update_fields
    if has_item_updates:
        existing_work_order = get_collection("work_orders").find_one({"request_id": boq["request_id"]})
        if existing_work_order:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="BOQ items cannot be changed after the work order is created.",
            )

        merged_items = merge_boq_item_updates(boq["items"], update_fields["items"])
        totals = recalculate_boq(merged_items)
        update_fields.update(totals)
        update_fields["approval_status"] = "pending"
        update_fields["approved_by"] = None
        update_fields["approved_at"] = None

    update_fields["updated_at"] = datetime.now(UTC)
    get_collection("boq").update_one(
        {"_id": boq["_id"]},
        {"$set": update_fields},
    )

    updated_boq = get_company_scoped_document_or_404('boq', boq_id, 'boq', current_user['company_id'])
    sync_request_workflow_state(request_id)
    publish_workflow_event("boq", "updated", request_id, {"boq_id": boq_id})
    return serialize_document(updated_boq)


@router.post("/{boq_id}/approve", response_model=BoqResponse)
def approve_boq(boq_id: str, payload: BoqApprovalAction, request: Request) -> dict[str, Any]:
    current_user = get_current_user(request)
    require_roles(current_user, UserRole.ADMIN, UserRole.FINANCE)
    boq = get_company_scoped_document_or_404('boq', boq_id, 'boq', current_user['company_id'])
    request_id = str(boq["request_id"])

    update_fields = {
        "approval_status": "approved",
        "approved_by": payload.approved_by,
        "approval_notes": payload.approval_notes,
        "approved_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    get_collection("boq").update_one({"_id": boq["_id"]}, {"$set": update_fields})

    updated_boq = get_company_scoped_document_or_404('boq', boq_id, 'boq', current_user['company_id'])
    sync_request_workflow_state(request_id)
    publish_workflow_event("boq", "approved", request_id, {"boq_id": boq_id})
    return serialize_document(updated_boq)


@router.post("/{boq_id}/reject", response_model=BoqResponse)
def reject_boq(boq_id: str, payload: BoqRejectionAction, request: Request) -> dict[str, Any]:
    current_user = get_current_user(request)
    require_roles(current_user, UserRole.ADMIN, UserRole.FINANCE)
    boq = get_company_scoped_document_or_404('boq', boq_id, 'boq', current_user['company_id'])
    request_id = str(boq["request_id"])

    existing_work_order = get_collection("work_orders").find_one({"request_id": boq["request_id"]})
    if existing_work_order:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="BOQ cannot be rejected after the work order is created.",
        )

    update_fields = {
        "approval_status": "rejected",
        "approval_notes": payload.approval_notes,
        "approved_by": None,
        "approved_at": None,
        "updated_at": datetime.now(UTC),
    }
    get_collection("boq").update_one({"_id": boq["_id"]}, {"$set": update_fields})

    updated_boq = get_company_scoped_document_or_404('boq', boq_id, 'boq', current_user['company_id'])
    sync_request_workflow_state(request_id)
    publish_workflow_event("boq", "rejected", request_id, {"boq_id": boq_id})
    return serialize_document(updated_boq)


@router.delete("/{boq_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_boq(boq_id: str, request: Request) -> Response:
    current_user = get_current_user(request)
    require_roles(current_user, UserRole.ADMIN)
    boq = get_company_scoped_document_or_404('boq', boq_id, 'boq', current_user['company_id'])
    request_id = str(boq["request_id"])

    get_collection("invoices").delete_many({"request_id": boq["request_id"]})
    get_collection("work_orders").delete_many({"request_id": boq["request_id"]})
    get_collection("boq").delete_one({"_id": boq["_id"]})

    sync_request_workflow_state(request_id)
    publish_workflow_event("boq", "deleted", request_id, {"boq_id": boq_id})
    return Response(status_code=status.HTTP_204_NO_CONTENT)
