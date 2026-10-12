"""Transport and entrypoint behavior, including a real local HTTP server."""
import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'functions' / 'creditgraph'))


class RuntimeTests(unittest.TestCase):
    def context(self, body_text='', body_json=None, headers=None):
        class Response:
            def json(self, data, status_code=200, headers=None):
                return {'data': data, 'status': status_code, 'headers': headers or {}}
        return SimpleNamespace(req=SimpleNamespace(body_text=body_text, body_json=body_json, headers=headers or {}), res=Response(), log=lambda value: None, error=lambda value: None)

    def test_entrypoint_handles_text_json_invalid_body_and_unauthenticated(self):
        from src.main import main
        for context in (self.context(body_json={'action': 'health'}), self.context(body_text='{"action":"health"}')):
            result = main(context)
            self.assertEqual(result['status'], 200)
            self.assertEqual(result['data']['service'], 'CreditGraph')
            self.assertEqual(result['headers']['Cache-Control'], 'no-store')
        for text in ('[1,2]', '{"action":NaN}', '{broken', 'x' * 200001):
            result = main(self.context(body_text=text))
            self.assertFalse(result['data']['ok'])
            self.assertIn(result['status'], (400, 413))
        result = main(self.context(body_text='{"action":"bootstrap","userId":"user-a"}'))
        self.assertEqual(result['status'], 401)

    def test_process_rate_limiter_caps_requests(self):
        from src.limits import RateLimiter
        from src.errors import ApiError
        limiter = RateLimiter()
        for _ in range(3):
            limiter.check('user-rate', 'collect')
        with self.assertRaises(ApiError) as caught:
            limiter.check('user-rate', 'collect')
        self.assertEqual(caught.exception.status, 429)
        limiter.check('different-owner', 'collect')

    def test_real_urllib_json_transport_and_no_redirects_or_error_leaks(self):
        from src.http import json_request
        from src.errors import ApiError
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                if self.path == '/redirect':
                    self.send_response(302)
                    self.send_header('Location', '/secret')
                    self.end_headers()
                    return
                self.send_response(500 if self.path == '/error' else 200)
                self.end_headers()
                content = {'/ok': b'{"ok":true}', '/error': b'private-provider-secret', '/bad': b'not-json', '/large': b'x' * 2100000}
                try:
                    self.wfile.write(content.get(self.path, b'credential-leak'))
                except (BrokenPipeError, ConnectionResetError):
                    pass
        server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = 'http://127.0.0.1:' + str(server.server_port)
            self.assertEqual(json_request('GET', base + '/ok', {}), {'ok': True})
            for path in ('/redirect', '/error', '/bad', '/large'):
                with self.subTest(path=path), self.assertRaises(ApiError) as caught:
                    json_request('GET', base + path, {'X-Appwrite-Key': 'test-secret'})
                self.assertNotIn('private-provider-secret', str(caught.exception))
                self.assertNotIn('test-secret', str(caught.exception))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


class AIGateTests(unittest.TestCase):
    def extract_event(self, quote, entities, source, entity_id, kind):
        from src.ai import extract_ai
        # Only the model transport is simulated; the evidence gate is real.
        def transport(method, url, headers, body, timeout):
            return {'choices': [{'message': {'content': json.dumps({'events': [
                {'entityId': entity_id, 'type': kind, 'quote': quote},
            ]})}}]}
        return extract_ai(quote, entities, source, {
            'AI_ENDPOINT': 'https://ai.example.test/v1',
            'AI_API_KEY': 'test-ai', 'AI_MODEL': 'test-model',
        }, transport)

    def test_company_issuer_cannot_hide_ambiguous_attribution(self):
        from src.errors import ApiError
        # Exact reported reproductions; a model assertion cannot resolve them.
        entities = [
            {'id': 'ireda', 'name': 'IREDA', 'aliases': [], 'role': 'company'},
            {'id': 'gensol', 'name': 'Gensol Engineering', 'aliases': ['Gensol'], 'role': 'company'},
        ]
        for quote in ('IREDA defaulted on its payment to Gensol.',
                      'Gensol repaid its debt, while IREDA defaulted.',
                      'IREDA reports: IREDA defaulted on its payment to Gensol.',
                      'IREDA reports: Gensol repaid its debt, while IREDA defaulted.'):
            for entity_id in ('gensol', 'ireda'):
                with self.subTest(quote=quote, entity_id=entity_id):
                    with self.assertRaises(ApiError) as caught:
                        self.extract_event(quote, entities, {
                            'sourceUrl': 'https://icra.in/report', 'issuerId': 'ireda',
                        }, entity_id, 'default')
                    self.assertEqual(caught.exception.status, 502)
        with self.assertRaises(ApiError):
            self.extract_event('IREDA defaulted.', entities, {
                'sourceUrl': 'https://icra.in/report', 'issuerId': 'ireda',
            }, 'ireda', 'default')

    def test_contracted_negation_and_uncertain_polarity_are_not_events(self):
        from src.errors import ApiError
        entities = [{'id': 'gensol', 'name': 'Gensol', 'aliases': [], 'role': 'company'}]
        for quote in ("Gensol hasn't defaulted.", 'Gensol hasn’t defaulted.',
                      "Gensol didn't default.", 'Gensol didn’t default.',
                      "Gensol won't default.", 'Gensol won’t default.',
                      'Gensol cannot default.',
                      'Gensol continues without default or liquidity stress.',
                      'It is unclear whether Gensol defaulted.',
                      'Gensol defaulted, but the claim is uncertain.',
                      'Gensol denied that it defaulted.'):
            for kind in ('default', 'liquidity_stress'):
                with self.subTest(quote=quote, kind=kind):
                    with self.assertRaises(ApiError) as caught:
                        self.extract_event(quote, entities, {
                            'sourceUrl': 'https://icra.in/report',
                        }, 'gensol', kind)
                    self.assertEqual(caught.exception.status, 502)

    def test_distinct_dates_do_not_select_an_arbitrary_event_date(self):
        entities = [{'id': 'gensol', 'name': 'Gensol', 'aliases': [], 'role': 'company'}]
        for quote in ('On 2025-01-01, Gensol scheduled a payment and then defaulted on 2025-02-01.',
                      'Gensol defaulted on 2025-02-01 after scheduling a payment on 2025-01-01.',
                      'On 2025-01-01 and 2025-01-02, Gensol defaulted on payments due 2024-12-31.'):
            with self.subTest(quote=quote):
                events = self.extract_event(quote, entities, {
                    'sourceUrl': 'https://icra.in/report', 'publishedAt': '2025-03-01',
                }, 'gensol', 'default')
                self.assertEqual(len(events), 1)
                self.assertEqual(events[0]['type'], 'default')
                self.assertEqual(events[0]['quote'], quote)
                self.assertIsNone(events[0]['eventDate'])
                self.assertEqual(events[0]['publishedAt'], '2025-03-01')
                self.assertEqual(events[0]['extractionMethod'], 'ai_validated')

    def test_repeated_single_date_is_not_ambiguous(self):
        quote = 'On 2025-01-01, Acme Limited defaulted on the payment due on 2025-01-01.'
        events = self.extract_event(quote, [
            {'id': 'acme', 'name': 'Acme Limited', 'aliases': [], 'role': 'company'},
        ], {'sourceUrl': 'https://icra.in/report'}, 'acme', 'default')
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['eventDate'], '2025-01-01')

    def test_historical_expected_npa_remains_an_explicit_expectation(self):
        # Exact historical source quotation retained by the deterministic suite.
        quote = ('CareEdge Ratings expects the gross NPA to increase in H1 FY2026 on account of '
                 'expected slippage of Gensol Engineering (Gensol) into NPA category.')
        events = self.extract_event(quote, [
            {'id': 'gensol', 'name': 'Gensol Engineering Limited',
             'aliases': ['Gensol Engineering', 'Gensol'], 'role': 'company'},
            {'id': 'ireda', 'name': 'Indian Renewable Energy Development Agency Limited',
             'aliases': ['IREDA'], 'role': 'company'},
            {'id': 'care', 'name': 'CareEdge Ratings', 'aliases': [], 'role': 'rating_agency'},
        ], {
            'sourceUrl': 'https://www.careratings.com/upload/CompanyFiles/PR/202506130648_Indian_Renewable_Energy_Development_Agency_Limited.pdf',
            'publishedAt': '2025-06-23', 'issuerId': 'ireda',
        }, 'gensol', 'expected_npa')
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['type'], 'expected_npa')
        self.assertEqual(events[0]['entityId'], 'gensol')
        self.assertEqual(events[0]['documentIssuerId'], 'ireda')
        self.assertEqual(events[0]['quote'], quote)
        self.assertEqual(events[0]['publishedAt'], '2025-06-23')
        self.assertIsNone(events[0]['eventDate'])
        self.assertTrue(events[0]['historical'])
        self.assertEqual(events[0]['extractionMethod'], 'ai_validated')
        self.assertEqual(events[0]['status'], 'candidate')

    def test_rating_agency_remains_distinct_from_downgrade_subject(self):
        quote = 'Example Ratings downgraded the rating of Acme Limited to BB on 2025-02-01.'
        events = self.extract_event(quote, [
            {'id': 'issuer', 'name': 'Example Ratings', 'aliases': [], 'role': 'rating_agency'},
            {'id': 'acme', 'name': 'Acme Limited', 'aliases': [], 'role': 'company'},
        ], {'sourceUrl': 'https://icra.in/report', 'issuerId': 'issuer'}, 'acme', 'rating_downgrade')
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['entityId'], 'acme')
        self.assertEqual(events[0]['documentIssuerId'], 'issuer')
        self.assertEqual(events[0]['eventDate'], '2025-02-01')
        self.assertEqual(events[0]['extractionMethod'], 'ai_validated')
        self.assertEqual(events[0]['quote'], quote)


if __name__ == '__main__':
    unittest.main()
