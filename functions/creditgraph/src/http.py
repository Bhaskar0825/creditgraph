"""Bounded JSON HTTP transport; redirects never forward server credentials."""
import json
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .errors import ApiError

MAX_RESPONSE = 2_000_000


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def json_request(method, url, headers, body=None, timeout=15):
    data = None if body is None else json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
    request = Request(url, data=data, headers=headers, method=method)
    try:
        with build_opener(NoRedirect()).open(request, timeout=timeout) as response:
            raw = response.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE:
                raise ApiError('Upstream response exceeded the supported size.', 502)
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise ValueError()
            return result
    except HTTPError as error:
        # Never return provider body, URL, request headers, or exception repr.
        status = error.code
        error.close()
        if status == 404:
            raise ApiError('Resource not found.', 404) from None
        if status == 409:
            raise ApiError('Resource conflict; reload before retrying.', 409) from None
        if status == 429:
            raise ApiError('Upstream rate limit reached; retry later.', 429) from None
        if status in (401, 403):
            raise ApiError('Upstream credentials or permissions are not configured correctly.', 503) from None
        raise ApiError('Upstream request failed; no success was confirmed.', 502) from None
    except (URLError, TimeoutError, OSError):
        raise ApiError('Upstream connection failed or timed out; retry after checking status.', 502) from None
    except (ValueError, UnicodeError):
        raise ApiError('Upstream returned invalid JSON.', 502) from None
