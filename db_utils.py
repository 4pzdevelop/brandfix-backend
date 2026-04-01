from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from fastapi import HTTPException, status
from pymongo import ASCENDING

from database import db
from models.request_model import RequestStatus


def get_collection(collection_name: str) -> Any:
    return db[collection_name]


def ensure_indexes() -> None:
    get_collection('users').create_index([('email', ASCENDING)], unique=True)
    get_collection('users').create_index([('company_id', ASCENDING)])
    get_collection('requests').create_index([('company_id', ASCENDING)])
    get_collection('requests').create_index([('status', ASCENDING)])
    get_collection('requests').create_index([('company_name', ASCENDING)])
    get_collection('recce').create_index([('request_id', ASCENDING)], unique=True)
    get_collection('boq').create_index([('request_id', ASCENDING)], unique=True)
    get_collection('work_orders').create_index([('request_id', ASCENDING)], unique=True)
    get_collection('invoices').create_index([('request_id', ASCENDING)], unique=True)
    get_collection('invoices').create_index([('invoice_no', ASCENDING)], unique=True)


def parse_object_id(document_id: str, resource_name: str) -> ObjectId:
    if not ObjectId.is_valid(document_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f'Invalid {resource_name} id.',
        )
    return ObjectId(document_id)


def serialize_value(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, list):
        return [serialize_value(item) for item in value]
    if isinstance(value, dict):
        return serialize_document(value)
    return value


def serialize_document(document: dict[str, Any] | None) -> dict[str, Any] | None:
    if document is None:
        return None

    serialized: dict[str, Any] = {}
    for key, value in document.items():
        if key == '_id':
            serialized['id'] = str(value)
        else:
            serialized[key] = serialize_value(value)
    return serialized


def get_document_or_404(
    collection_name: str,
    document_id: str,
    resource_name: str,
) -> dict[str, Any]:
    collection = get_collection(collection_name)
    object_id = parse_object_id(document_id, resource_name)
    document = collection.find_one({'_id': object_id})
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f'{resource_name.title()} not found.',
        )
    return document


def get_request_or_404(request_id: str) -> dict[str, Any]:
    return get_document_or_404('requests', request_id, 'request')


def get_company_scoped_request_or_404(request_id: str, company_id: str) -> dict[str, Any]:
    request_document = get_request_or_404(request_id)
    if request_document.get('company_id') != company_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail='Request not found.',
        )
    return request_document


def get_company_scoped_document_or_404(
    collection_name: str,
    document_id: str,
    resource_name: str,
    company_id: str,
) -> dict[str, Any]:
    document = get_document_or_404(collection_name, document_id, resource_name)

    if collection_name == 'requests':
        if document.get('company_id') != company_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f'{resource_name.title()} not found.',
            )
        return document

    linked_request = get_collection('requests').find_one(
        {'_id': document.get('request_id'), 'company_id': company_id}
    )
    if linked_request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f'{resource_name.title()} not found.',
        )
    return document


def build_company_scoped_query(company_id: str, request_id: str | None = None) -> dict[str, Any]:
    if request_id:
        request_document = get_company_scoped_request_or_404(request_id, company_id)
        return {'request_id': request_document['_id']}

    request_ids = [
        document['_id']
        for document in get_collection('requests').find({'company_id': company_id}, {'_id': 1})
    ]
    return {'request_id': {'$in': request_ids}}


def sync_request_workflow_state(request_id: str) -> dict[str, Any]:
    request_object_id = parse_object_id(request_id, 'request')
    request = get_collection('requests').find_one({'_id': request_object_id})
    if request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail='Request not found.',
        )

    recce = get_collection('recce').find_one({'request_id': request_object_id})
    boq = get_collection('boq').find_one({'request_id': request_object_id})
    work_order = get_collection('work_orders').find_one({'request_id': request_object_id})
    invoice = get_collection('invoices').find_one({'request_id': request_object_id})

    next_status = determine_request_status(recce, boq, work_order, invoice)
    get_collection('requests').update_one(
        {'_id': request_object_id},
        {
            '$set': {
                'status': next_status,
                'recce_id': str(recce['_id']) if recce else None,
                'boq_id': str(boq['_id']) if boq else None,
                'work_order_id': str(work_order['_id']) if work_order else None,
                'invoice_id': str(invoice['_id']) if invoice else None,
                'updated_at': datetime.now(UTC),
            }
        },
    )

    updated_request = get_collection('requests').find_one({'_id': request_object_id})
    return serialize_document(updated_request)


def determine_request_status(
    recce: dict[str, Any] | None,
    boq: dict[str, Any] | None,
    work_order: dict[str, Any] | None,
    invoice: dict[str, Any] | None,
) -> str:
    if invoice:
        return RequestStatus.invoiced.value
    if work_order and (
        work_order.get('reported_at')
        or work_order.get('final_report_notes')
        or work_order.get('final_report_files')
    ):
        return RequestStatus.final_report_submitted.value
    if work_order and work_order.get('status') == 'in_progress':
        return RequestStatus.work_in_progress.value
    if work_order:
        return RequestStatus.work_order_created.value
    if boq and boq.get('approval_status') == 'approved':
        return RequestStatus.approved.value
    if boq:
        return RequestStatus.boq_generated.value
    if recce:
        return RequestStatus.recce_completed.value
    return RequestStatus.request_created.value
