"""Bound public source metadata; no user-directed network destinations."""
import re
from datetime import date, datetime
from urllib.parse import urlsplit

from .errors import ApiError

APPROVED_DOMAINS = ('careratings.com', 'icra.in', 'bseindia.com', 'nseindia.com', 'bis.org', 'ireda.in')


def public_url(value):
    if not isinstance(value, str) or not value or len(value) > 2000 or re.search(r'[\s\\\x00-\x1f\x7f]', value):
        raise ApiError('Use a valid approved public HTTPS source URL.', 400)
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ''
        if (parsed.scheme != 'https' or parsed.username is not None or parsed.password is not None
                or ':' in parsed.netloc or '%' in parsed.netloc or parsed.fragment
                or not any(host == domain or host.endswith('.' + domain) for domain in APPROVED_DOMAINS)
                or len(host) > 253
                or not all(re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?', label) for label in host.split('.'))):
            raise ValueError()
    except ValueError:
        raise ApiError('Use an approved HTTPS source without credentials, ports or fragments.', 400) from None
    return value


def source_metadata(body, entities):
    source = {'sourceUrl': public_url(body.get('sourceUrl'))}
    published = body.get('publishedAt')
    if published not in (None, ''):
        if not isinstance(published, str) or len(published) > 35:
            raise ApiError('Invalid source publication date.', 400)
        try:
            if len(published) == 10:
                date.fromisoformat(published)
            else:
                datetime.fromisoformat(published.replace('Z', '+00:00'))
        except ValueError:
            raise ApiError('Invalid source publication date.', 400) from None
        source['publishedAt'] = published
    issuer = body.get('issuerId')
    if issuer not in (None, '') and issuer not in {e['id'] for e in entities}:
        raise ApiError('Source issuer is not a known entity.', 400)
    source['issuerId'] = issuer or None
    title = body.get('sourceTitle') or 'Public source'
    page = body.get('page')
    if not isinstance(title, str) or len(title) > 300 or (page is not None and (type(page) is not int or not 1 <= page <= 10000)):
        raise ApiError('Invalid source title or page.', 400)
    source.update(sourceTitle=title, page=page)
    return source
