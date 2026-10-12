"""Function tests: only HTTP transport is replaced; domain/storage code is real."""
import copy
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'functions' / 'creditgraph'))
ENV = {'APPWRITE_ENDPOINT': 'https://appwrite.example.test/v1',
       'APPWRITE_PROJECT_ID': 'test-project', 'APPWRITE_API_KEY': 'test-key'}


class DatabaseHTTP:
    """Small REST test double, not a replacement for backend authorization."""
    def __init__(self):
        self.rows = {name: {} for name in ('entities', 'events', 'relationships', 'reviews', 'runs')}
        self.calls = []
        self.remote = []

    def seed(self, collection, identifier, owner, payload):
        self.rows[collection][identifier] = {
            '$id': identifier, '$permissions': [], 'owner': owner,
            'kind': collection[:-1], 'payload': json.dumps(payload),
        }

    def __call__(self, method, url, headers, body=None, timeout=15):
        from src.errors import ApiError
        self.calls.append((method, url, dict(headers), copy.deepcopy(body)))
        parts = urlsplit(url)
        if parts.hostname != 'appwrite.example.test':
            if not self.remote:
                raise AssertionError('Unexpected external request')
            return copy.deepcopy(self.remote.pop(0))
        bits = parts.path.split('/')
        collection = bits[5]
        identifier = unquote(bits[7]) if len(bits) > 7 else None
        rows = self.rows[collection]
        if method == 'GET' and identifier:
            if identifier not in rows:
                raise ApiError('Resource not found.', 404)
            return copy.deepcopy(rows[identifier])
        if method == 'GET':
            values = sorted(rows.values(), key=lambda item: item['$id'])
            limit, after = 25, None
            for q in parse_qs(parts.query).get('queries[]', []):
                query = json.loads(q)
                if query['method'] == 'equal':
                    values = [v for v in values if v.get(query['attribute']) in query['values']]
                elif query['method'] == 'limit':
                    limit = query['values'][0]
                elif query['method'] == 'cursorAfter':
                    after = query['values'][0]
            total = len(values)
            if after:
                values = [v for v in values if v['$id'] > after]
            return {'total': total, 'rows': copy.deepcopy(values[:limit])}
        if method == 'POST':
            identifier = body['rowId']
            if identifier in rows:
                raise ApiError('Conflict.', 409)
            rows[identifier] = {'$id': identifier, '$permissions': body['permissions'], **body['data']}
        elif method == 'PATCH':
            if identifier not in rows:
                raise ApiError('Resource not found.', 404)
            rows[identifier].update(body['data'])
            rows[identifier]['$permissions'] = body['permissions']
        else:
            raise AssertionError(method)
        return copy.deepcopy(rows[identifier])


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.network = DatabaseHTTP()

    def service(self, extra=None):
        from src.service import Service
        return Service({**ENV, **(extra or {})}, transport=self.network)

    def test_health_is_only_public_action_and_body_cannot_claim_identity(self):
        from src.errors import ApiError
        service = self.service()
        self.assertEqual(service.handle({'action': 'health'}, {}), {
            'ok': True, 'service': 'CreditGraph', 'tinyfishConfigured': False, 'aiConfigured': False,
        })
        for action in ('bootstrap', 'review', 'extract', 'collect', 'runStatus'):
            with self.subTest(action=action), self.assertRaises(ApiError) as caught:
                service.handle({'action': action, 'userId': 'user-a'}, {})
            self.assertEqual(caught.exception.status, 401)
        self.assertEqual(self.network.calls, [])

    def test_bootstrap_paginates_and_never_returns_another_owner(self):
        for index in range(125):
            self.network.seed('entities', f'entity-{index:03}', 'public', {'id': f'entity-{index:03}', 'name': 'Public issuer', 'aliases': [], 'role': 'company'})
        self.network.seed('events', 'mine', 'user-a', {'id': 'mine', 'status': 'candidate'})
        self.network.seed('events', 'other', 'user-b', {'id': 'other', 'status': 'candidate'})
        self.network.seed('reviews', 'public-review', 'public', {'id': 'public-review'})
        result = self.service().handle({'action': 'bootstrap'}, {'x-appwrite-user-id': 'user-a', 'x-appwrite-key': 'dynamic-test-key'})
        self.assertEqual(len(result['entities']), 125)
        self.assertEqual([r['id'] for r in result['events']], ['mine'])
        self.assertEqual(result['reviews'], [])
        self.assertTrue(all('/tablesdb/creditgraph/tables/' in c[1] for c in self.network.calls))
        self.assertTrue(all(c[2]['X-Appwrite-Key'] == 'dynamic-test-key' for c in self.network.calls))
        self.assertGreater(len([c for c in self.network.calls if '/entities/' in c[1]]), 1)

    def test_review_is_private_deterministic_and_read_back(self):
        from src.errors import ApiError
        self.network.seed('events', 'public-event', 'public', {'id': 'public-event', 'status': 'candidate'})
        self.network.seed('events', 'secret-event', 'user-b', {'id': 'secret-event'})
        service = self.service()
        result = service.handle({'action': 'review', 'eventId': 'public-event', 'status': 'approved', 'note': 'Checked quote', 'userId': 'user-b'}, {'x-appwrite-user-id': 'user-a'})
        second = service.handle({'action': 'review', 'eventId': 'public-event', 'status': 'dismissed', 'note': ''}, {'x-appwrite-user-id': 'user-a'})
        self.assertEqual(result['review']['id'], second['review']['id'])
        self.assertEqual(len(self.network.rows['reviews']), 1)
        row = next(iter(self.network.rows['reviews'].values()))
        self.assertEqual(row['owner'], 'user-a')
        self.assertEqual(row['$permissions'], [])
        self.assertEqual(self.network.calls[-1][0], 'GET')
        self.assertEqual(json.loads(self.network.rows['events']['public-event']['payload'])['status'], 'candidate')
        with self.assertRaises(ApiError) as caught:
            service.handle({'action': 'review', 'eventId': 'secret-event', 'status': 'approved'}, {'x-appwrite-user-id': 'user-a'})
        self.assertEqual(caught.exception.status, 404)
        self.assertEqual(service.handle({'action': 'bootstrap'}, {'x-appwrite-user-id': 'user-b'})['reviews'], [])

    def test_extraction_persists_only_candidates_scoped_to_caller(self):
        self.network.seed('entities', 'acme', 'public', {'id': 'acme', 'name': 'Acme Limited', 'aliases': [], 'role': 'company'})
        self.network.seed('entities', 'publisher', 'public', {'id': 'publisher', 'name': 'Example Publisher', 'aliases': [], 'role': 'company'})
        body = {'action': 'extract', 'text': 'Example Publisher reports: Acme Limited defaulted.',
                'sourceUrl': 'https://www.icra.in/report', 'publishedAt': '2025-01-02', 'issuerId': 'publisher'}
        service = self.service()
        result = service.handle(body, {'x-appwrite-user-id': 'user-a'})
        self.assertEqual(result['mode'], 'deterministic_rules')
        self.assertEqual(len(result['events']), 1)
        event = result['events'][0]
        self.assertEqual(event['status'], 'candidate')
        self.assertEqual(event['entityId'], 'acme')
        self.assertEqual(event['documentIssuerId'], 'publisher')
        self.assertEqual(self.network.rows['events'][event['id']]['owner'], 'user-a')
        self.assertEqual(self.network.calls[-1][0], 'GET')
        second = service.handle(body, {'x-appwrite-user-id': 'user-b'})
        self.assertNotEqual(event['id'], second['events'][0]['id'])
        self.assertEqual(service.handle({'action': 'bootstrap'}, {'x-appwrite-user-id': 'user-b'})['events'], second['events'])

    def test_extraction_rejects_bad_source_and_oversized_or_private_payload(self):
        from src.errors import ApiError
        service = self.service()
        for extras in ({'text': 'a' * 30001}, {'sourceUrl': 'javascript:alert(1)'},
                       {'publishedAt': 'not-a-date'}, {'positions': [{'amount': 100}]},
                       {'issuerId': 'missing'}):
            body = {'action': 'extract', 'text': 'Acme Limited defaulted.', 'sourceUrl': 'https://icra.in/report', **extras}
            with self.subTest(extras=list(extras)), self.assertRaises(ApiError):
                service.handle(body, {'x-appwrite-user-id': 'user-a'})
        self.assertFalse(self.network.rows['events'])

    def test_optional_ai_output_is_strictly_validated_and_not_inferred(self):
        from src.errors import ApiError
        self.network.seed('entities', 'acme', 'public', {'id': 'acme', 'name': 'Acme Limited', 'aliases': [], 'role': 'company'})
        self.network.seed('entities', 'publisher', 'public', {'id': 'publisher', 'name': 'Example Publisher', 'aliases': [], 'role': 'company'})
        config = {'AI_ENDPOINT': 'https://ai.example.test/v1', 'AI_API_KEY': 'test-ai', 'AI_MODEL': 'test-model'}
        quote = 'Example Publisher reports: Acme Limited defaulted.'
        body = {'action': 'extract', 'text': quote, 'sourceUrl': 'https://icra.in/report', 'issuerId': 'publisher'}
        self.network.remote.append({'choices': [{'message': {'content': json.dumps({'events': [{'entityId': 'acme', 'type': 'default', 'quote': quote}]})}}]})
        result = self.service(config).handle(body, {'x-appwrite-user-id': 'user-a'})
        self.assertEqual(result['mode'], 'ai_validated')
        self.assertEqual(result['events'][0]['quote'], quote)
        ai_call = next(c for c in self.network.calls if '/chat/completions' in c[1])
        self.assertEqual(ai_call[3]['response_format']['type'], 'json_schema')
        self.assertTrue(ai_call[3]['response_format']['json_schema']['strict'])
        for event in ({'entityId': 'publisher', 'type': 'default', 'quote': quote},
                      {'entityId': 'acme', 'type': 'default', 'quote': 'Acme Limited invented a default.'},
                      {'entityId': 'acme', 'type': 'rating_upgrade', 'quote': quote},
                      {'entityId': 'acme', 'type': 'default', 'quote': quote, 'extra': 'ignored?'}):
            self.network.remote.append({'choices': [{'message': {'content': json.dumps({'events': [event]})}}]})
            with self.subTest(event=event), self.assertRaises(ApiError) as caught:
                self.service(config).handle(body, {'x-appwrite-user-id': 'user-a'})
            self.assertEqual(caught.exception.status, 502)

    def test_tinyfish_async_run_ownership_and_validated_results(self):
        from src.errors import ApiError
        service = self.service({'TINYFISH_API_KEY': 'test-tinyfish'})
        self.network.remote.append({'run_id': 'provider-run-123', 'error': None})
        created = service.handle({'action': 'collect', 'url': 'https://icra.in/report', 'companyName': 'Acme Limited'}, {'x-appwrite-user-id': 'user-a'})
        self.assertEqual(created['status'], 'PENDING')
        run_id = created['runId']
        self.assertEqual(self.network.rows['runs'][run_id]['owner'], 'user-a')
        external = [c for c in self.network.calls if 'tinyfish.ai' in c[1]]
        self.assertEqual(len(external), 1)
        self.assertEqual(external[0][1], 'https://agent.tinyfish.ai/v1/automation/run-async')
        self.assertEqual(set(external[0][3]), {'url', 'goal', 'output_schema'})
        before = len(self.network.calls)
        with self.assertRaises(ApiError) as caught:
            service.handle({'action': 'runStatus', 'runId': run_id}, {'x-appwrite-user-id': 'user-b'})
        self.assertEqual(caught.exception.status, 404)
        self.assertFalse(any('tinyfish.ai' in c[1] for c in self.network.calls[before:]))
        self.network.remote.append({'run_id': 'provider-run-123', 'status': 'COMPLETED', 'result': {
            'text': 'Acme Limited defaulted.', 'sourceUrl': 'https://icra.in/report',
            'sourceTitle': 'Public report', 'publishedAt': '2025-01-01'}, 'error': None})
        done = service.handle({'action': 'runStatus', 'runId': run_id}, {'x-appwrite-user-id': 'user-a'})
        self.assertEqual(done['status'], 'COMPLETED')
        self.assertEqual(done['results']['text'], 'Acme Limited defaulted.')
        self.assertEqual(self.network.calls[-1][0], 'GET')
        before = len(self.network.calls)
        service.handle({'action': 'runStatus', 'runId': run_id}, {'x-appwrite-user-id': 'user-a'})
        self.assertFalse(any('tinyfish.ai' in c[1] for c in self.network.calls[before:]))

    def test_tinyfish_missing_key_and_invalid_urls_fail_without_external_call(self):
        from src.errors import ApiError
        with self.assertRaises(ApiError) as caught:
            self.service().handle({'action': 'collect', 'url': 'https://icra.in/report', 'companyName': 'Acme Limited'}, {'x-appwrite-user-id': 'user-a'})
        self.assertEqual(caught.exception.status, 503)
        self.assertIn('TINYFISH_API_KEY', str(caught.exception))
        service = self.service({'TINYFISH_API_KEY': 'test-tinyfish'})
        for url in ('http://icra.in', 'https://icra.in.evil.test', 'https://evil-icra.in',
                    'https://icra.in@127.0.0.1', 'https://127.0.0.1', 'https://[::1]',
                    'https://icra.in:443', 'https://user@icra.in', 'https://icra.in\\@evil.test',
                    'https://icra.in./report', 'https://icra.in/#secret', 'https://icra.in\n/report'):
            with self.subTest(url=url), self.assertRaises(ApiError):
                service.handle({'action': 'collect', 'url': url, 'companyName': 'Acme Limited'}, {'x-appwrite-user-id': 'user-a'})
        self.assertFalse(any('tinyfish.ai' in c[1] for c in self.network.calls))
        self.assertFalse(self.network.rows['runs'])

    def test_storage_owner_check_blocks_collision_and_readback_drift(self):
        from src.errors import ApiError
        from src.service import scoped_id
        self.network.seed('events', 'shared-event', 'public', {'id': 'shared-event'})
        review_id = scoped_id('rev_', 'user-a', 'shared-event')
        self.network.seed('reviews', review_id, 'user-b', {'id': review_id, 'status': 'approved'})
        with self.assertRaises(ApiError) as caught:
            self.service().handle({'action': 'review', 'eventId': 'shared-event', 'status': 'dismissed'}, {'x-appwrite-user-id': 'user-a'})
        self.assertEqual(caught.exception.status, 404)
        self.assertFalse(any(c[0] == 'PATCH' for c in self.network.calls))
        self.assertEqual(self.network.rows['reviews'][review_id]['owner'], 'user-b')

    def test_incomplete_ai_configuration_is_not_silent_rule_fallback(self):
        from src.errors import ApiError
        with self.assertRaises(ApiError) as caught:
            self.service({'AI_API_KEY': 'test-ai'}).handle({'action': 'extract', 'text': 'Public text.', 'sourceUrl': 'https://icra.in/report'}, {'x-appwrite-user-id': 'user-a'})
        self.assertEqual(caught.exception.status, 503)
        self.assertFalse(self.network.rows['events'])

    def test_failed_or_redirected_tinyfish_results_never_become_evidence(self):
        service = self.service({'TINYFISH_API_KEY': 'test-tinyfish'})
        for provider_response in ({'status': 'FAILED', 'error': {'message': 'secret-token'}},
                                  {'status': 'COMPLETED', 'result': {'text': 'x', 'sourceUrl': 'https://icra.in.evil.test/', 'sourceTitle': 'Bad', 'publishedAt': None}}):
            self.network.remote.append({'run_id': 'provider-run-123', 'error': None})
            created = service.handle({'action': 'collect', 'url': 'https://icra.in/report', 'companyName': 'Acme Limited'}, {'x-appwrite-user-id': 'user-a'})
            self.network.remote.append({'run_id': 'provider-run-123', **provider_response})
            result = service.handle({'action': 'runStatus', 'runId': created['runId']}, {'x-appwrite-user-id': 'user-a'})
            self.assertEqual(result['status'], 'FAILED')
            self.assertIsNone(result['results'])
            self.assertNotIn('secret-token', json.dumps(result))
            self.assertFalse(self.network.rows['events'])

    def test_storage_rejects_incomplete_pagination_total(self):
        from src.errors import ApiError
        from src.storage import Store
        def broken_network(method, url, headers, body=None, timeout=15):
            return {'total': 101, 'rows': []}
        store = Store(ENV, {}, broken_network)
        with self.assertRaises(ApiError) as caught:
            store.list('entities', 'user-a')
        self.assertEqual(caught.exception.status, 502)

    def test_rejects_malformed_json_fields_and_unsafe_source_host_labels(self):
        from src.errors import ApiError
        from src.validation import public_url
        for action in ([], {}, 1, None):
            with self.subTest(action=action), self.assertRaises(ApiError) as caught:
                self.service().handle({'action': action}, {'x-appwrite-user-id': 'user-a'})
            self.assertEqual(caught.exception.status, 400)
        for url in ('https://..icra.in/report', 'https://-a.icra.in/report', 'https://a-.icra.in/report'):
            with self.subTest(url=url), self.assertRaises(ApiError):
                public_url(url)

    def test_bootstrap_owner_filter_defends_against_broken_query_provider(self):
        from src.storage import Store
        def broad_network(method, url, headers, body=None, timeout=15):
            return {'total': 2, 'rows': [
                {'$id': 'private', 'owner': 'user-b', 'payload': '{"secret":true}'},
                {'$id': 'public', 'owner': 'public', 'payload': '{"name":"Public record"}'},
            ]}
        self.assertEqual(Store(ENV, {}, broad_network).list('entities', 'user-a'), [{'id': 'public', 'name': 'Public record'}])

    def test_storage_env_runtime_values_override_fallbacks(self):
        from src.storage import Store
        store = Store({**ENV, 'APPWRITE_FUNCTION_API_ENDPOINT': 'https://runtime.example.test/v1', 'APPWRITE_FUNCTION_PROJECT_ID': 'runtime-project'}, {'x-appwrite-key': 'runtime-key'}, self.network)
        self.assertTrue(store.url('events').startswith('https://runtime.example.test/v1/'))
        self.assertEqual(store.headers['X-Appwrite-Project'], 'runtime-project')
        self.assertEqual(store.headers['X-Appwrite-Key'], 'runtime-key')
        fallback = Store(ENV, {}, self.network)
        self.assertEqual(fallback.headers['X-Appwrite-Key'], 'test-key')

    def test_tinyfish_ambiguous_creation_is_recorded_failed_without_retry(self):
        from src.errors import ApiError
        self.network.remote.append({'run_id': None, 'error': {'message': 'private failure details'}})
        with self.assertRaises(ApiError) as caught:
            self.service({'TINYFISH_API_KEY': 'test-tinyfish'}).handle({'action': 'collect', 'url': 'https://icra.in/report', 'companyName': 'Acme Limited'}, {'x-appwrite-user-id': 'user-a'})
        self.assertEqual(caught.exception.status, 502)
        self.assertEqual(len(self.network.rows['runs']), 1)
        self.assertEqual(json.loads(next(iter(self.network.rows['runs'].values()))['payload'])['status'], 'FAILED')
        self.assertEqual(len([c for c in self.network.calls if 'tinyfish.ai' in c[1]]), 1)

    def test_pasted_private_fields_never_reach_ai_or_tinyfish(self):
        from src.errors import ApiError
        for action in ('extract', 'collect'):
            body = {'action': action, 'text': 'Public text', 'sourceUrl': 'https://icra.in/report', 'url': 'https://icra.in/report', 'companyName': 'Acme Limited', 'portfolio': [{'amount': '10000'}]}
            with self.subTest(action=action), self.assertRaises(ApiError):
                self.service({'TINYFISH_API_KEY': 'test-tinyfish', 'AI_ENDPOINT': 'https://ai.example.test/v1', 'AI_API_KEY': 'test-ai', 'AI_MODEL': 'test-model'}).handle(body, {'x-appwrite-user-id': 'user-a'})
        self.assertFalse(any('appwrite.example.test' not in c[1] for c in self.network.calls))

    def test_write_readback_checks_payload_owner_and_private_permissions(self):
        from src.errors import ApiError
        from src.storage import Store
        for corruption in ('permissions', 'payload'):
            network = DatabaseHTTP()
            mutated = False
            def corrupt_network(method, url, headers, body=None, timeout=15):
                nonlocal mutated
                result = network(method, url, headers, body, timeout)
                if method in ('POST', 'PATCH'):
                    mutated = True
                if method == 'GET' and mutated:
                    if corruption == 'permissions':
                        result['$permissions'] = ['read("any")']
                    else:
                        result['payload'] = '{"id":"review-id","status":"dismissed"}'
                return result
            with self.subTest(corruption=corruption), self.assertRaises(ApiError) as caught:
                Store(ENV, {}, corrupt_network).put('reviews', 'review-id', 'user-a', 'review', {'id': 'review-id', 'status': 'approved'})
            self.assertEqual(caught.exception.status, 409)


if __name__ == '__main__':
    unittest.main()
