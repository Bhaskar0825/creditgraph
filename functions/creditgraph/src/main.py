"""Appwrite Python Function entrypoint: main(context)."""
import json
import os

from .errors import ApiError
from .service import Service

MAX_BODY_BYTES = 200000


def request_body(req):
    raw = getattr(req, 'body_text', None)
    if raw:
        if not isinstance(raw, str) or len(raw.encode()) > MAX_BODY_BYTES:
            raise ApiError('Request body is too large.', 413)
        try:
            value = json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError()))
        except (ValueError, RecursionError):
            raise ApiError('Request must contain valid JSON.', 400) from None
    else:
        try:
            value = getattr(req, 'body_json', None)
            encoded = json.dumps(value, allow_nan=False).encode()
            if len(encoded) > MAX_BODY_BYTES:
                raise ApiError('Request body is too large.', 413)
        except (TypeError, ValueError, RecursionError):
            raise ApiError('Request must contain valid JSON.', 400) from None
    if not isinstance(value, dict):
        raise ApiError('Request must be a JSON object.', 400)
    return value


def main(context):
    status = 200
    try:
        body = request_body(context.req)
        headers = {str(k).lower(): v for k, v in (getattr(context.req, 'headers', {}) or {}).items()}
        owner = headers.get('x-appwrite-user-id')
        if isinstance(owner, str) and owner and body.get('action') != 'health':
            from .limits import LIMITER
            LIMITER.check(owner, str(body.get('action')))
        payload = Service(os.environ).handle(body, headers)
    except ApiError as error:
        payload, status = {'ok': False, 'error': str(error)}, error.status
    except Exception:
        # Never log source text, keys, user identifiers or provider exception contents.
        context.error('CreditGraph request failed unexpectedly.')
        payload, status = {'ok': False, 'error': 'The request could not be completed. Retry after checking workspace status.'}, 500
    return context.res.json(payload, status, {'Cache-Control': 'no-store', 'Content-Type': 'application/json'})
