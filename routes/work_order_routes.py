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
from models.work_order_model import (
    FinalReportCreate,
    WorkOrderCreate,
    WorkOrderResponse,
    WorkOrderStatus,
    WorkOrderUpdate,
)
from models.user_model import UserRole
from services.notification_service import publish_workflow_event


router = APIRouter(prefix="/work-orders", tags=["Work Orders"])


@router.post("", response_model=WorkOrderResponse, status_code=status.HTTP_201_CREATED)
def create_work_order(payload: WorkOrderCreate, request: Request) -> dict[str, Any]:
    current_user = get_current_user(request)
    require_roles(current_user, UserRole.ADMIN)
    request_document = get_company_scoped_request_or_404(payload.request_id, current_user['company_id'])
    request_object_id = request_document['_id']

    boq = get_collection("boq").find_one({"request_id": request_object_id})
    if boq is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Generate and approve the BOQ before creating a work order.",
        )
    if boq.get("approval_status") != "approved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="BOQ approval is required before a work order can be created.",
        )

    existing_work_order = get_collection("work_orders").find_one({"request_id": request_object_id})
    if existing_work_order:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A work order already exists for this request.",
        )

    now = datetime.now(UTC)
    document = {
        "request_id": request_object_id,
        "boq_id": boq["_id"],
        "status": WorkOrderStatus.created.value,
        "started_at": None,
        "completed_at": None,
        "before_photos": [],
        "after_photos": [],
        "final_report_notes": None,
        "final_report_files": [],
        "reported_at": None,
        "created_at": now,
        "updated_at": now,
    }
    result = get_collection("work_orders").insert_one(document)
    document["_id"] = result.inserted_id

    sync_request_workflow_state(payload.request_id)
    publish_workflow_event(
        "work_order",
        "created",
        payload.request_id,
        {"work_order_id": str(result.inserted_id)},
    )
    return serialize_document(document)


@router.get("", response_model=list[WorkOrderResponse])
def list_work_orders(
    request: Request,
    request_id: str | None = Query(default=None, alias="requestId"),
) -> list[dict[str, Any]]:
    current_user = get_current_user(request)
    query = build_company_scoped_query(current_user['company_id'], request_id)
    cursor = get_collection("work_orders").find(query).sort("created_at", -1)
    return [serialize_document(document) for document in cursor]


@router.get("/{work_order_id}", response_model=WorkOrderResponse)
def get_work_order(work_order_id: str, request: Request) -> dict[str, Any]:
    current_user = get_current_user(request)
    work_order = get_company_scoped_document_or_404(
        'work_orders',
        work_order_id,
        'work order',
        current_user['company_id'],
    )
    return serialize_document(work_order)


@router.put("/{work_order_id}", response_model=WorkOrderResponse)
def update_work_order(work_order_id: str, payload: WorkOrderUpdate, request: Request) -> dict[str, Any]:
    current_user = get_current_user(request)
    require_roles(current_user, UserRole.ADMIN, UserRole.FIELD)
    work_order = get_company_scoped_document_or_404(
        'work_orders',
        work_order_id,
        'work order',
        current_user['company_id'],
    )
    request_id = str(work_order["request_id"])

    invoice = get_collection("invoices").find_one({"request_id": work_order["request_id"]})
    if invoice:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Work order cannot be modified after the invoice has been generated.",
        )

    update_fields = payload.model_dump(exclude_none=True)
    if not update_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one field is required for update.",
        )

    now = datetime.now(UTC)
    if update_fields.get("status") == WorkOrderStatus.in_progress.value and not work_order.get("started_at"):
        update_fields["started_at"] = now
    if update_fields.get("status") == WorkOrderStatus.completed.value and not work_order.get("completed_at"):
        update_fields["completed_at"] = now

    update_fields["updated_at"] = now
    get_collection("work_orders").update_one(
        {"_id": work_order["_id"]},
        {"$set": update_fields},
    )

    updated_work_order = get_company_scoped_document_or_404(
        'work_orders',
        work_order_id,
        'work order',
        current_user['company_id'],
    )
    sync_request_workflow_state(request_id)
    publish_workflow_event("work_order", "updated", request_id, {"work_order_id": work_order_id})
    return serialize_document(updated_work_order)


@router.post("/{work_order_id}/final-report", response_model=WorkOrderResponse)
def submit_final_report(work_order_id: str, payload: FinalReportCreate, request: Request) -> dict[str, Any]:
    current_user = get_current_user(request)
    require_roles(current_user, UserRole.ADMIN, UserRole.FIELD)
    work_order = get_company_scoped_document_or_404(
        'work_orders',
        work_order_id,
        'work order',
        current_user['company_id'],
    )
    request_id = str(work_order["request_id"])

    invoice = get_collection("invoices").find_one({"request_id": work_order["request_id"]})
    if invoice:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Final report cannot be changed after the invoice has been generated.",
        )

    report_time = payload.reported_at or datetime.now(UTC)
    update_fields = {
        "status": WorkOrderStatus.completed.value,
        "completed_at": work_order.get("completed_at") or report_time,
        "final_report_notes": payload.final_report_notes,
        "final_report_files": payload.final_report_files,
        "reported_at": report_time,
        "updated_at": datetime.now(UTC),
    }
    if not work_order.get("started_at"):
        update_fields["started_at"] = report_time

    get_collection("work_orders").update_one(
        {"_id": work_order["_id"]},
        {"$set": update_fields},
    )

    updated_work_order = get_company_scoped_document_or_404(
        'work_orders',
        work_order_id,
        'work order',
        current_user['company_id'],
    )
    sync_request_workflow_state(request_id)
    publish_workflow_event(
        "final_report",
        "submitted",
        request_id,
        {"work_order_id": work_order_id},
    )
    return serialize_document(updated_work_order)


@router.delete("/{work_order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_work_order(work_order_id: str, request: Request) -> Response:
    current_user = get_current_user(request)
    require_roles(current_user, UserRole.ADMIN)
    work_order = get_company_scoped_document_or_404(
        'work_orders',
        work_order_id,
        'work order',
        current_user['company_id'],
    )
    request_id = str(work_order["request_id"])

    get_collection("invoices").delete_many({"request_id": work_order["request_id"]})
    get_collection("work_orders").delete_one({"_id": work_order["_id"]})

    sync_request_workflow_state(request_id)
    publish_workflow_event("work_order", "deleted", request_id, {"work_order_id": work_order_id})
    return Response(status_code=status.HTTP_204_NO_CONTENT)
