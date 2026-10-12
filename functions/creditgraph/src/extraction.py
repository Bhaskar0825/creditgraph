"""Conservative, evidence-only candidates; deterministic rules are not AI."""
import hashlib
import re
from datetime import date, datetime, timezone

PATTERNS = (
    # Explicit forecast only; never promote expected NPA slippage to default.
    ('expected_npa', r'\bexpected slippage of [^.!?\n]{1,200}\binto NPA category\b'),
    ('rating_downgrade', r'\b(?:downgraded?|downgrading)\b'),
    ('default', r'\b(?:defaulted|default|missed (?:a |the )?(?:debt |interest )?payment)\b'),
    ('negative_outlook', r'\b(?:negative outlook|outlook[^.!?\n]{0,25}negative)\b'),
    ('liquidity_stress', r'\b(?:liquidity (?:stress|pressure|constraints?|crunch)|cash flow (?:stress|pressure))\b'),
    ('insolvency', r'\b(?:insolvency|bankruptcy)\b'),
    ('investigation', r'\b(?:investigations?|investigated|enforcement action)\b'),
    ('rating_upgrade', r'\b(?:upgraded?|upgrading)\b'),
)


def contains_name(quote, name):
    return bool(name and re.search(r'(?<!\w)' + re.escape(name) + r'(?!\w)', quote, re.I))


def event_type(quote):
    # Prefer false negatives to asserting a negated, hypothetical or instructed event.
    if re.search(r"\b(?:\w+n['’]t|not|no|never|without|cannot|could|may|might|would|if|"
                 r'unclear|uncertain|whether|denied|risk of|potential|'
                 r'ignore|instructions?|system prompt|pretend|imagine)\b', quote, re.I):
        return None
    for kind, pattern in PATTERNS:
        if re.search(pattern, quote, re.I):
            return kind
    return None


def sentence_quotes(text):
    # Slices, not normalized/reconstructed sentences: evidence stays byte-for-byte.
    return [part.strip() for part in re.split(r'(?<=[!?])\s+|(?<=\.)\s+(?=[A-Z])|\n+', text) if part.strip()]


def subjects(quote, entities, issuer_id):
    matches = []
    for entity in entities:
        if entity.get('role') in ('rating_agency', 'regulator', 'publisher'):
            continue
        names = [entity['name'], *entity.get('aliases', [])]
        evidence = quote
        if entity['id'] == issuer_id:
            # Only an explicit reporting prefix proves the issuer is not the subject.
            # Any repeated issuer mention in the reported clause still counts.
            for name in names:
                prefix = re.match(r'\s*' + re.escape(name) + r'\s+reports:\s*', quote, re.I)
                if name and prefix:
                    evidence = quote[prefix.end():]
                    break
        if any(contains_name(evidence, name) for name in names):
            matches.append(entity)
    # Count company issuers before rejecting ambiguous attribution in both gates.
    if len(matches) != 1 or matches[0]['id'] == issuer_id:
        return []
    return matches


def explicit_date(quote):
    matches = set(re.findall(r'\b\d{4}-\d{2}-\d{2}\b', quote))
    # Multiple dates need event/date relation parsing; never pick by text order.
    if len(matches) != 1:
        return None
    try:
        return date.fromisoformat(matches.pop()).isoformat()
    except ValueError:
        return None


def make_event(quote, entity, kind, source, method):
    stable = '\0'.join((source['sourceUrl'], entity['id'], kind, quote))
    now = datetime.now(timezone.utc)
    # Publication age only: this does not establish current borrower status.
    try:
        historical = date.fromisoformat(source.get('publishedAt') or '') < now.date()
    except (TypeError, ValueError):
        historical = False  # Unknown publication date is not evidence of recency.
    return {
        'id': 'evt_' + hashlib.sha256(stable.encode()).hexdigest()[:28],
        'entityId': entity['id'], 'documentIssuerId': source.get('issuerId') or None,
        'type': kind, 'title': entity['name'] + ': ' + kind.replace('_', ' '),
        'summary': quote, 'eventDate': explicit_date(quote),
        'publishedAt': source.get('publishedAt') or None,
        'firstSeenAt': now.isoformat(),
        'sourceUrl': source['sourceUrl'], 'sourceTitle': source.get('sourceTitle') or 'Public source',
        'page': source.get('page'), 'quote': quote, 'status': 'candidate',
        'historical': historical, 'extractionMethod': method,
    }


def extract_candidates(text, entities, source):
    results = {}
    for quote in sentence_quotes(text):
        if len(quote) > 1500:
            continue
        kind = event_type(quote)
        found = subjects(quote, entities, source.get('issuerId'))
        if kind and len(found) == 1:
            event = make_event(quote, found[0], kind, source, 'deterministic_rules')
            results[event['id']] = event
        if len(results) >= 30:
            break
    return list(results.values())
