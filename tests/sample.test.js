import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleData, SAMPLE_CSV } from '../src/sample-data.js';

test('historical public records carry provenance and keep borrower separate from issuer', () => {
  assert.equal(sampleData.entities.length, 3);
  assert.equal(sampleData.events.length, 3);
  for (const event of sampleData.events) {
    assert.equal(event.historical, true);
    assert.match(event.sourceUrl, /^https:\/\/www\.careratings\.com\//);
    assert.ok(event.quote.length > 50);
    assert.equal(event.status, 'candidate');
    assert.equal(event.documentIssuerId, 'ireda');
  }
  assert.equal(sampleData.events.find(e=>e.type==='governance_concern').entityId, 'gensol');
  assert.equal(sampleData.events.find(e=>e.type==='expected_npa').entityId, 'gensol');
});

test('public relationship amounts are not sample private positions', () => {
  assert.equal(sampleData.relationships[0].amount, '7289500000.00');
  assert.equal(sampleData.relationships[0].approximate, true);
  assert.ok(!SAMPLE_CSV.includes(sampleData.relationships[0].amount));
  assert.ok(SAMPLE_CSV.includes('SAMPLE-001'));
});
