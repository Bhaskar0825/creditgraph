import test from 'node:test';
import assert from 'node:assert/strict';
import { publicConfig, createCloudClient } from '../src/api.js';

test('cloud endpoint and project require explicit deployment configuration', () => {
  assert.equal(publicConfig.endpoint, '');
  assert.equal(publicConfig.projectId, '');
});

test('incomplete cloud configuration fails before sending any request', async () => {
  const requests = [];
  const fetcher = async (url) => { requests.push(url); return new Response('{}'); };
  for (const config of [
    { endpoint: '', projectId: 'test-project' },
    { endpoint: 'https://cloud.example.com/v1', projectId: '' },
  ]) {
    const client = createCloudClient({ ...config, fetcher });
    await assert.rejects(client.connect(), /not configured/i);
    await assert.rejects(client.call('health'), /not configured/i);
    assert.equal(client.connected, false);
  }
  assert.deepEqual(requests, []);
});
