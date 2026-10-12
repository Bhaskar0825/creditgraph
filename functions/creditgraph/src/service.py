"""Authenticated action boundary for CreditGraph."""
import hashlib
import re
from datetime import datetime, timezone

from .errors import ApiError
from .storage import Store, TABLES


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,35}', value):
        raise ApiError('Invalid record identifier.', 400)
    return value


def scoped_id(prefix, owner, value):
    return prefix + hashlib.sha256((owner + '\0' + value).encode()).hexdigest()[:28]



class Service:
    def __init__(self, env, transport=None):
        from .http import json_request
        self.env = env
        self.transport = transport or json_request

    def handle(self, body, headers):
        action = body.get('action')
        if action == 'health':
            return {'ok': True, 'service': 'CreditGraph',
                    'tinyfishConfigured': bool(self.env.get('TINYFISH_API_KEY')),
                    'aiConfigured': all(self.env.get(k) for k in ('AI_ENDPOINT', 'AI_API_KEY', 'AI_MODEL'))}
        headers = {str(k).lower(): v for k, v in headers.items()}
        owner = headers.get('x-appwrite-user-id')
        if not isinstance(owner, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,35}', owner) or owner == 'public':
            raise ApiError('Connect a private workspace before using this action.', 401)
        if action not in ('bootstrap', 'review', 'extract', 'collect', 'runStatus'):
            raise ApiError('Unknown action.', 400)
        store = Store(self.env, headers, self.transport)
        if action == 'bootstrap':
            return {'ok': True, **{table: store.list(table, owner) for table in TABLES}}
        if action == 'review':
            event_id = identifier(body.get('eventId'))
            status = body.get('status')
            note = body.get('note', '')
            if status not in ('candidate', 'approved', 'dismissed') or not isinstance(note, str) or len(note) > 2000:
                raise ApiError('Invalid review status or note (maximum 2,000 characters).', 400)
            store.get('events', event_id, owner, allow_public=True)
            review_id = scoped_id('rev_', owner, event_id)
            review = {'id': review_id, 'eventId': event_id, 'status': status, 'note': note,
                      'updatedAt': datetime.now(timezone.utc).isoformat()}
            return {'ok': True, 'review': store.put('reviews', review_id, owner, 'review', review)}
        if action == 'extract':
            from .extraction import extract_candidates
            from .validation import source_metadata
            text = body.get('text')
            if not isinstance(text, str) or not text.strip() or len(text) > 30000:
                raise ApiError('Provide public source text between 1 and 30,000 characters.', 400)
            if any(key in body for key in ('positions', 'portfolio', 'exposures', 'amounts', 'apiKey', 'endpoint', 'model')):
                raise ApiError('Only public source text and source metadata may be submitted.', 400)
            entities = store.list('entities', owner)
            source = source_metadata(body, entities)
            mode = 'deterministic_rules'
            if any(self.env.get(key) for key in ('AI_ENDPOINT', 'AI_API_KEY', 'AI_MODEL')):
                from .ai import extract_ai
                events = extract_ai(text, entities, source, self.env, self.transport)
                mode = 'ai_validated'
            else:
                events = extract_candidates(text, entities, source)
            saved = []
            for event in events:
                event['id'] = scoped_id('evt_', owner, event['id'])
                try:
                    existing = store.get('events', event['id'], owner)
                    event['firstSeenAt'] = existing['firstSeenAt']
                except ApiError as error:
                    if error.status != 404:
                        raise
                saved.append(store.put('events', event['id'], owner, 'event', event))
            return {'ok': True, 'events': saved, 'mode': mode}
        if action == 'collect':
            from .tinyfish import collect
            return collect(body, owner, store, self.env, self.transport)
        if action == 'runStatus':
            from .tinyfish import run_status
            return run_status(identifier(body.get('runId')), owner, store, self.env, self.transport)
        raise ApiError('Unknown action.', 400)
