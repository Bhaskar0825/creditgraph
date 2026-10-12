"""Private Appwrite TablesDB records; permission checks also run in Python."""
import json
from urllib.parse import quote, urlencode

from .errors import ApiError

TABLES = ('entities', 'events', 'relationships', 'reviews', 'runs')
PAGE_SIZE = 100
MAX_ROWS = 2000


def query(method, values, attribute=None):
    value = {'method': method, 'values': values}
    if attribute:
        value['attribute'] = attribute
    return json.dumps(value, separators=(',', ':'))


class Store:
    def __init__(self, env, headers, transport):
        endpoint = env.get('APPWRITE_FUNCTION_API_ENDPOINT') or env.get('APPWRITE_ENDPOINT')
        project = env.get('APPWRITE_FUNCTION_PROJECT_ID') or env.get('APPWRITE_PROJECT_ID')
        key = headers.get('x-appwrite-key') or env.get('APPWRITE_API_KEY')
        if not all((endpoint, project, key)):
            raise ApiError('Workspace storage is not configured.', 503)
        self.base = endpoint.rstrip('/') + '/tablesdb/creditgraph/tables/'
        self.headers = {'X-Appwrite-Project': project, 'X-Appwrite-Key': key, 'Content-Type': 'application/json'}
        self.transport = transport

    def url(self, table, identifier=None):
        if table not in TABLES:
            raise ApiError('Invalid storage table.', 400)
        return self.base + table + '/rows' + ('/' + quote(identifier, safe='') if identifier else '')

    def list(self, table, owner):
        allowed = ['public', owner] if table in TABLES[:3] else [owner]
        rows, cursor, expected, seen = [], None, None, set()
        while True:
            queries = [query('equal', allowed, 'owner'), query('limit', [PAGE_SIZE]), query('orderAsc', [], '$id')]
            if cursor:
                queries.append(query('cursorAfter', [cursor]))
            result = self.transport('GET', self.url(table) + '?' + urlencode([('queries[]', q) for q in queries]), self.headers)
            page = result.get('rows')
            if not isinstance(page, list) or len(page) > PAGE_SIZE or type(result.get('total')) is not int:
                raise ApiError('Invalid storage response.', 502)
            if expected is None:
                expected = result['total']
            if expected != result['total']:
                raise ApiError('Workspace changed during pagination; reload.', 409)
            if expected > MAX_ROWS or len(seen) + len(page) > MAX_ROWS:
                raise ApiError('Workspace exceeds the supported row limit.', 413)
            for row in page:
                if not isinstance(row, dict) or not row.get('$id') or row['$id'] in seen:
                    raise ApiError('Invalid storage pagination.', 502)
                seen.add(row['$id'])
                if row.get('owner') in allowed:
                    payload = self.payload(row)
                    # Storage ID is authoritative, never a payload-supplied identity.
                    payload['id'] = row['$id']
                    rows.append(payload)
            if len(rows) > MAX_ROWS:
                raise ApiError('Workspace exceeds the supported row limit.', 413)
            if len(page) < PAGE_SIZE:
                if len(seen) != expected:
                    raise ApiError('Incomplete storage pagination; reload.', 502)
                return rows
            next_cursor = page[-1].get('$id')
            if not next_cursor or next_cursor == cursor:
                raise ApiError('Invalid storage pagination.', 502)
            cursor = next_cursor

    def get(self, table, identifier, owner, allow_public=False):
        row = self.transport('GET', self.url(table, identifier), self.headers)
        if row.get('owner') not in ([owner, 'public'] if allow_public else [owner]):
            raise ApiError('Resource not found.', 404)
        if row.get('$permissions') != []:
            raise ApiError('Record privacy verification failed.', 409)
        result = self.payload(row)
        result['id'] = row['$id']
        return result

    def put(self, table, identifier, owner, kind, payload):
        serialized = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        if len(serialized.encode()) > 60000:
            raise ApiError('Record exceeds the supported size.', 413)
        data = {'owner': owner, 'kind': kind, 'payload': serialized}
        exists = False
        try:
            self.get(table, identifier, owner)
            exists = True
        except ApiError as error:
            if error.status != 404:
                raise
        if exists:
            self.transport('PATCH', self.url(table, identifier), self.headers, {'data': data, 'permissions': []})
        else:
            try:
                self.transport('POST', self.url(table), self.headers,
                               {'rowId': identifier, 'data': data, 'permissions': []})
            except ApiError as error:
                if error.status != 409:
                    raise
                # Another write may have created it; verify ownership before updating.
                self.get(table, identifier, owner)
                self.transport('PATCH', self.url(table, identifier), self.headers, {'data': data, 'permissions': []})
        actual = self.get(table, identifier, owner)
        if actual != {**payload, 'id': identifier}:
            raise ApiError('Write could not be verified; reload before retrying.', 409)
        return actual

    @staticmethod
    def payload(row):
        try:
            result = json.loads(row['payload'])
            if not isinstance(result, dict):
                raise ValueError()
            return result
        except (KeyError, TypeError, ValueError):
            raise ApiError('Invalid workspace record.', 502) from None
