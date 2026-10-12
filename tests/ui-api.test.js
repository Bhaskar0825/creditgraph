import test from 'node:test';
import assert from 'node:assert/strict';

let api = {};
try { api = await import('../src/api.js'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

test('public-source payload validation rejects private portfolio fields and invalid source inputs', () => {
  assert.equal(typeof api.safePayload, 'function', 'safePayload must exist before public data can leave the browser');
  assert.throws(() => api.safePayload('extract', { text: 'Public filing', positions: [{ amount: '90000' }] }), /private|unexpected/i);
  assert.throws(() => api.safePayload('extract', { text: ' ', sourceUrl: 'https://example.com/report' }), /text/i);
  assert.throws(() => api.safePayload('extract', { text: 'a'.repeat(30001), sourceUrl: 'https://example.com/report' }), /30,?000/);
  assert.throws(() => api.safePayload('extract', { text: 'position_id,entity_id,currency,amount,as_of\nPRIVATE,company,INR,9000,2025-01-01', sourceUrl: 'https://example.com/report' }), /portfolio|private/i);
  assert.throws(() => api.safePayload('extract', { text: 'Public event', sourceUrl: 'https://example.com/report', publishedAt: '2025-02-31' }), /date/i);
  assert.throws(() => api.safePayload('collect', { url: 'http://127.0.0.1/private', companyName: 'Example Company' }), /public|https/i);
  assert.throws(() => api.safePayload('collect', { url: 'https://user:secret@example.com', companyName: 'Example Company' }), /credential|public/i);
  assert.deepEqual(api.safePayload('review', { eventId: 'event-1', status: 'approved', note: 'Evidence checked' }), { action: 'review', eventId: 'event-1', status: 'approved', note: 'Evidence checked' });
  assert.throws(() => api.safePayload('review', { eventId: 'event-1', status: 'approved', userId: 'other' }), /unexpected/i);
  assert.throws(() => api.safePayload('delete', {}), /action/i);
});

test('cloud client is explicit-connect, sends only validated fields, and isolates fallback sessions', async () => {
  assert.equal(typeof api.createCloudClient, 'function', 'a private cloud client must exist');
  const requests = [];
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const fetcher = async (url, options) => {
    requests.push({ url, ...options });
    if (url.endsWith('/account')) return new Response(JSON.stringify({ message: 'No session' }), { status: 401 });
    if (url.endsWith('/anonymous')) return new Response('{}', { headers: { 'X-Fallback-Cookies': 'opaque-session' } });
    const action = JSON.parse(JSON.parse(options.body).body).action;
    return new Response(JSON.stringify({ responseStatusCode: 200, responseBody: JSON.stringify({ ok: true, action, entities: [], events: [], reviews: [], relationships: [], runs: [] }) }));
  };
  const client = api.createCloudClient({ endpoint: 'https://cloud.example.com/v1', projectId: 'demo', functionId: 'creditgraph-api', fetcher, storage });
  assert.equal(requests.length, 0, 'no requests before an explicit action');
  await assert.rejects(client.call('bootstrap'), /connect/i);
  assert.equal(requests.length, 0);
  await client.connect();
  const result = await client.call('bootstrap');
  assert.equal(result.ok, true);
  assert.equal(requests.length, 3);
  assert.equal(requests[2].headers['X-Fallback-Cookies'], 'opaque-session');
  assert.equal(requests[2].headers['X-Appwrite-Project'], 'demo');
  assert.equal(requests[2].credentials, 'include');
  assert.equal(requests[2].headers['X-Appwrite-Key'], undefined);
  await assert.rejects(client.call('review', { eventId: 'e', status: 'approved', positions: [] }), /unexpected/i);
  assert.equal(requests.length, 3, 'invalid data must be rejected before fetch');
});

test('workspace hydration applies analyst decisions without changing source issuer or affected company', () => {
  assert.equal(typeof api.hydrateWorkspace, 'function');
  const source = { entities: [{ id: 'company', name: 'Example Company' }], events: [{ id: 'event', entityId: 'company', documentIssuerId: 'issuer', quote: 'Exact source quote', status: 'candidate' }], reviews: [{ eventId: 'event', status: 'approved', note: 'Read source' }], relationships: [], runs: [] };
  const data = api.hydrateWorkspace(source);
  assert.equal(data.events[0].status, 'approved');
  assert.equal(data.events[0].entityId, 'company');
  assert.equal(data.events[0].documentIssuerId, 'issuer');
  assert.equal(data.events[0].quote, 'Exact source quote');
  assert.equal(source.events[0].status, 'candidate');
  assert.deepEqual(api.hydrateWorkspace({}).events, []);
});

test('source metadata preserves publisher title and page while bounding collection labels', () => {
  const source = { text: 'Public evidence', sourceUrl: 'https://example.com/report', sourceTitle: 'Example Ratings — Report', page: 3, issuerId: 'company' };
  assert.deepEqual(api.safePayload('extract', source), { action: 'extract', ...source });
  assert.throws(() => api.safePayload('collect', { url: 'https://example.com/report', companyName: 'a'.repeat(161) }), /160/);
  assert.throws(() => api.safePayload('extract', { ...source, page: -1 }), /page/i);
});

test('a browser that blocks sessionStorage still opens the local dashboard client', () => {
  const previous = globalThis.window;
  globalThis.window = Object.defineProperty({}, 'sessionStorage', { get() { throw new Error('Storage blocked'); } });
  try { assert.doesNotThrow(() => api.createCloudClient()); } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test('first private import replaces synthetic positions and subsequent imports deduplicate atomically', () => {
  assert.equal(typeof api.mergeExposureImport, 'function');
  const sample = { positionId: 'sample', entityId: 'company', amountMinor: '100', currency: 'INR', asOf: '2025-01-01' };
  const real = { ...sample, positionId: 'private', amountMinor: '500' };
  const first = api.mergeExposureImport([sample], { positions: [real], duplicates: 0 }, true);
  assert.deepEqual(first.positions, [real]);
  assert.equal(first.added, 1);
  const second = api.mergeExposureImport(first.positions, { positions: [real], duplicates: 1 }, false);
  assert.equal(second.added, 0);
  assert.equal(second.duplicates, 2);
  assert.throws(() => api.mergeExposureImport(first.positions, { positions: [{...real, amountMinor: '900'}], duplicates: 0 }, false), /different values/);
  assert.equal(first.positions[0].amountMinor, '500');
});

test('cloud execution surfaces server error instead of pretending a successful action', async () => {
  assert.equal(typeof api.createCloudClient, 'function');
  const client = api.createCloudClient({ endpoint: 'https://cloud.example.com/v1', projectId: 'demo', fetcher: async () => new Response(JSON.stringify({ responseStatusCode: 503, responseBody: JSON.stringify({ ok: false, error: 'TinyFish not configured' }) })) });
  await assert.rejects(client.call('health'), /TinyFish not configured/);
});
