from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response, status

from db_utils import (
    get_collection,
    get_document_or_404,
    get_request_or_404,
    parse_object_id,
    serialize_document,
    sync_request_workflow_state,
)
from models.invoice_model import InvoiceCreate, InvoiceResponse, InvoiceUpdate
from services.notification_service import publish_workflow_event


router = APIRouter(prefix="/invoices", tags=["Invoices"])


def generate_invoice_number(request_id: str) -> str:
    date_token = datetime.now(UTC).strftime("%Y%m%d")
    base_invoice_no = f"BFX-{date_token}-{request_id[-6:].upper()}"
    invoice_number = base_invoice_no
    suffix = 1

    while get_collection("invoices").find_one({"invoice_no": invoice_number}):
        suffix += 1
        invoice_number = f"{base_invoice_no}-{suffix}"

    return invoice_number


@router.post("", response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED)
def create_invoice(payload: InvoiceCreate) -> dict[str, Any]:
    get_request_or_404(payload.request_id)
    request_object_id = parse_object_id(payload.request_id, "request")

    boq = get_collection("boq").find_one({"request_id": request_object_id})
    if boq is None or boq.get("approval_status") != "approved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An approved BOQ is required before invoice generation.",
        )

    work_order = get_collection("work_orders").find_one({"request_id": request_object_id})
    if work_order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Create and complete the work order before invoice generation.",
        )
    if not (
        work_order.get("reported_at")
        or work_order.get("final_report_notes")
        or work_order.get("final_report_files")
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Submit the final report before generating the invoice.",
        )

    existing_invoice = get_collection("invoices").find_one({"request_id": request_object_id})
    if existing_invoice:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An invoice already exists for this request.",
        )

    invoice_number = payload.invoice_no or generate_invoice_number(payload.request_id)
    invoice_date = (payload.invoice_date or date.today()).isoformat()
    now = datetime.now(UTC)

    document = {
        "request_id": request_object_id,
        "boq_id": boq["_id"],
        "work_order_id": work_order["_id"],
        "invoice_no": invoice_number,
        "invoice_date": invoice_date,
        "taxable_amount": boq["subtotal"],
        "cgst": boq["cgst"],
        "sgst": boq["sgst"],
        "grand_total": boq["grand_total"],
        "created_at": now,
        "updated_at": now,
    }
    result = get_collection("invoices").insert_one(document)
    document["_id"] = result.inserted_id

    sync_request_workflow_state(payload.request_id)
    publish_workflow_event("invoice", "created", payload.request_id, {"invoice_id": str(result.inserted_id)})
    return serialize_document(document)


@router.get("", response_model=list[InvoiceResponse])
def list_invoices(
    request_id: str | None = Query(default=None, alias="requestId"),
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if request_id:
        query["request_id"] = parse_object_id(request_id, "request")

    cursor = get_collection("invoices").find(query).sort("created_at", -1)
    return [serialize_document(document) for document in cursor]


@router.get("/{invoice_id}", response_model=InvoiceResponse)
def get_invoice(invoice_id: str) -> dict[str, Any]:
    invoice = get_document_or_404("invoices", invoice_id, "invoice")
    return serialize_document(invoice)


@router.put("/{invoice_id}", response_model=InvoiceResponse)
def update_invoice(invoice_id: str, payload: InvoiceUpdate) -> dict[str, Any]:
    invoice = get_document_or_404("invoices", invoice_id, "invoice")
    request_id = str(invoice["request_id"])
    boq = get_collection("boq").find_one({"_id": invoice["boq_id"]})

    if boq is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Linked BOQ not found for this invoice.",
        )

    update_fields = payload.model_dump(exclude_none=True)
    if not update_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one field is required for update.",
        )

    if "invoice_date" in update_fields:
        update_fields["invoice_date"] = update_fields["invoice_date"].isoformat()

    update_fields.update(
        {
            "taxable_amount": boq["subtotal"],
            "cgst": boq["cgst"],
            "sgst": boq["sgst"],
            "grand_total": boq["grand_total"],
            "updated_at": datetime.now(UTC),
        }
    )
    get_collection("invoices").update_one(
        {"_id": invoice["_id"]},
        {"$set": update_fields},
    )

    updated_invoice = get_document_or_404("invoices", invoice_id, "invoice")
    sync_request_workflow_state(request_id)
    publish_workflow_event("invoice", "updated", request_id, {"invoice_id": invoice_id})
    return serialize_document(updated_invoice)


@router.delete("/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_invoice(invoice_id: str) -> Response:
    invoice = get_document_or_404("invoices", invoice_id, "invoice")
    request_id = str(invoice["request_id"])

    get_collection("invoices").delete_one({"_id": invoice["_id"]})

    sync_request_workflow_state(request_id)
    publish_workflow_event("invoice", "deleted", request_id, {"invoice_id": invoice_id})
    return Response(status_code=status.HTTP_204_NO_CONTENT)
