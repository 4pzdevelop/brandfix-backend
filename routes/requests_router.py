from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status

from database import db
from db_utils import (
    get_company_scoped_document_or_404,
    parse_object_id,
    serialize_document,
)
from middleware.auth_middleware import get_current_user, require_roles
from models.request_model import RequestCreate, RequestResponse, RequestStatus, RequestUpdate
from models.response_model import DataResponse
from models.user_model import UserRole
from services.notification_service import publish_workflow_event


router = APIRouter(prefix='/requests', tags=['Requests'])
requests_collection = db['requests']
recce_collection = db['recce']
boq_collection = db['boq']
work_orders_collection = db['work_orders']
invoices_collection = db['invoices']


@router.post('', response_model=DataResponse[RequestResponse], status_code=status.HTTP_201_CREATED)
def create_request(payload: RequestCreate, request: Request) -> dict[str, Any]:
    current_user = get_current_user(request)
    require_roles(current_user, UserRole.ADMIN)

    if payload.company_id != current_user['company_id']:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Requests can only be created for the authenticated company.',
        )

    now = datetime.now(UTC)
    document = {
        **payload.model_dump(),
        'status': RequestStatus.request_created.value,
        'recce_id': None,
        'boq_id': None,
        'work_order_id': None,
        'invoice_id': None,
        'created_at': now,
        'updated_at': now,
    }
    result = requests_collection.insert_one(document)
    document['_id'] = result.inserted_id

    request_id = str(result.inserted_id)
    publish_workflow_event('request', 'created', request_id, {'status': document['status']})
    return {'data': serialize_document(document)}


@router.get('', response_model=DataResponse[list[RequestResponse]])
def list_requests(
    request: Request,
    company_id: str | None = Query(default=None, alias='companyId'),
    company_name: str | None = Query(default=None, alias='companyName'),
    status_filter: RequestStatus | None = Query(default=None, alias='status'),
) -> dict[str, list[dict[str, Any]]]:
    current_user = get_current_user(request)

    if company_id and company_id != current_user['company_id']:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='You can only query requests for your company.',
        )

    query: dict[str, Any] = {'company_id': current_user['company_id']}
    if company_name:
        query['company_name'] = {'$regex': company_name, '$options': 'i'}
    if status_filter:
        query['status'] = status_filter.value

    cursor = requests_collection.find(query).sort('created_at', -1)
    return {'data': [serialize_document(document) for document in cursor]}


@router.get('/{request_id}', response_model=DataResponse[RequestResponse])
def get_request(request_id: str, request: Request) -> dict[str, Any]:
    current_user = get_current_user(request)
    request_document = get_company_scoped_document_or_404(
        'requests',
        request_id,
        'request',
        current_user['company_id'],
    )
    return {'data': serialize_document(request_document)}


@router.put('/{request_id}', response_model=DataResponse[RequestResponse])
def update_request(request_id: str, payload: RequestUpdate, request: Request) -> dict[str, Any]:
    current_user = get_current_user(request)
    require_roles(current_user, UserRole.ADMIN)

    existing_request = get_company_scoped_document_or_404(
        'requests',
        request_id,
        'request',
        current_user['company_id'],
    )
    update_fields = payload.model_dump(exclude_none=True)
    if not update_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='At least one field is required for update.',
        )

    if 'company_id' in update_fields and update_fields['company_id'] != existing_request['company_id']:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Requests cannot be moved to another company.',
        )

    update_fields['updated_at'] = datetime.now(UTC)
    requests_collection.update_one(
        {'_id': parse_object_id(request_id, 'request')},
        {'$set': update_fields},
    )

    updated_request = get_company_scoped_document_or_404(
        'requests',
        request_id,
        'request',
        current_user['company_id'],
    )
    publish_workflow_event('request', 'updated', request_id, update_fields)
    return {'data': serialize_document(updated_request)}


@router.delete('/{request_id}', response_model=DataResponse[str])
def delete_request(request_id: str, request: Request) -> dict[str, str]:
    current_user = get_current_user(request)
    require_roles(current_user, UserRole.ADMIN)
    get_company_scoped_document_or_404('requests', request_id, 'request', current_user['company_id'])
    request_object_id = parse_object_id(request_id, 'request')

    recce_collection.delete_many({'request_id': request_object_id})
    boq_collection.delete_many({'request_id': request_object_id})
    work_orders_collection.delete_many({'request_id': request_object_id})
    invoices_collection.delete_many({'request_id': request_object_id})
    requests_collection.delete_one({'_id': request_object_id})

    publish_workflow_event('request', 'deleted', request_id)
    return {'data': 'deleted'}
