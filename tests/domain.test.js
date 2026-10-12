import test from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../src/domain.js';

const entities = [
  { id: 'borrower-a', name: 'Acme Credit Limited', aliases: ['Acme Credit'], role: 'borrower' },
  { id: 'borrower-b', name: 'Beacon Holdings', aliases: ['Beacon'], role: 'borrower' },
];
const header = 'position_id,entity_id,currency,amount,as_of';

test('reads quoted commas, escaped quotes and newlines without splitting a record', () => {
  const csv = `${header}\r\n"p,1",borrower-a,GBP,"12.30",2025-01-01\r\n"p""2\r\nline",borrower-b,EUR,0,2025-01-02\r\n`;
  const result = domain.parseExposureCSV(csv, entities);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.positions.map(p => [p.positionId, p.amountMinor]), [
    ['p,1', '1230'], ['p"2\r\nline', '0'],
  ]);
});

test('rejects malformed CSV syntax without importing a partial file', () => {
  for (const row of [
    '"p-1,borrower-a,USD,1.00,2025-01-01',
    'p"1,borrower-a,USD,1.00,2025-01-01',
    '"p-1"junk,borrower-a,USD,1.00,2025-01-01',
  ]) {
    const result = domain.parseExposureCSV(`${header}\np-ok,borrower-a,USD,2.00,2025-01-01\n${row}`, entities);
    assert.equal(result.positions.length, 0, row);
    assert.match(result.errors.join(' '), /CSV.*(quote|quoted)/i);
  }
});

test('requires exactly the documented CSV header and accepts a UTF-8 BOM', () => {
  for (const input of ['', 'wrong,header', `${header},extra`, header.replace('amount', 'currency')]) {
    const result = domain.parseExposureCSV(input, entities);
    assert.deepEqual(result.positions, []);
    assert.match(result.errors.join(' '), /header/i);
  }
  const result = domain.parseExposureCSV(`\uFEFF${header}\r\np-1,borrower-a,USD,1,2025-01-01\r\n\r\n`, entities);
  assert.deepEqual(result.errors, []);
  assert.equal(result.positions.length, 1);
});

test('rejects nondecimal, negative and overprecision amounts with row errors', () => {
  const badAmounts = ['-1', '-0.00', '+1', '1e3', 'NaN', 'Infinity', '1.001', '.1', '1.', '', ' 1', '1 ', '1,000.00'];
  for (const amount of badAmounts) {
    const result = domain.parseExposureCSV(`${header}\np-1,borrower-a,USD,"${amount}",2025-01-01`, entities);
    assert.deepEqual(result.positions, [], amount);
    assert.match(result.errors.join(' '), /row 2.*amount/i, amount);
  }
  const result = domain.parseExposureCSV(`${header}\np-1,borrower-a,USD,0.10,2025-01-01\np-2,borrower-a,USD,-2,2025-01-01`, entities);
  assert.equal(result.positions.length, 1);
  assert.equal(result.errors.length, 1);
});

test('rejects invalid calendar dates rather than allowing Date rollover', () => {
  for (const asOf of ['2025-02-29', '2024-02-30', '2025-04-31', '1900-02-29', '2025-00-01', '2025-13-01', '2025-01-00', '2025-1-01', '0000-01-01', '2025-01-01T00:00:00Z', '']) {
    const result = domain.parseExposureCSV(`${header}\np-1,borrower-a,USD,1,${asOf}`, entities);
    assert.deepEqual(result.positions, [], asOf);
    assert.match(result.errors.join(' '), /as_of/i, asOf);
  }
  for (const asOf of ['2000-02-29', '2024-02-29', '2025-12-31']) {
    assert.equal(domain.parseExposureCSV(`${header}\np-1,borrower-a,USD,1,${asOf}`, entities).positions.length, 1);
  }
});

test('rejects unknown identifiers, unsupported currencies and malformed row widths', () => {
  const cases = [
    ['p-1,missing,USD,1,2025-01-01', /entity_id/],
    ['p-1, borrower-a,USD,1,2025-01-01', /entity_id/],
    ['p-1,,USD,1,2025-01-01', /entity_id/],
    [',borrower-a,USD,1,2025-01-01', /position_id/],
    [' ,borrower-a,USD,1,2025-01-01', /position_id/],
    ['p-1,borrower-a,JPY,1,2025-01-01', /currency/],
    ['p-1,borrower-a,usd,1,2025-01-01', /currency/],
    ['p-1,borrower-a,USD,1,2025-01-01,extra', /five fields/],
    ['p-1,borrower-a,USD,1', /five fields/],
  ];
  for (const [row, error] of cases) {
    const result = domain.parseExposureCSV(`${header}\n${row}`, entities);
    assert.deepEqual(result.positions, [], row);
    assert.match(result.errors.join(' '), error);
  }
});

test('counts identical duplicate position IDs once using normalized exact money', () => {
  const result = domain.parseExposureCSV(`${header}\np-1,borrower-a,USD,1,2025-01-01\np-1,borrower-a,USD,01.00,2025-01-01\np-2,borrower-a,USD,2,2025-01-01`, entities);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.positions.map(p => p.positionId), ['p-1', 'p-2']);
});

test('quarantines every occurrence of a conflicting duplicate regardless of row order', () => {
  const original = 'p-1,borrower-a,USD,1,2025-01-01';
  for (const conflicting of [
    'p-1,borrower-a,USD,2,2025-01-01',
    'p-1,borrower-b,USD,1,2025-01-01',
    'p-1,borrower-a,EUR,1,2025-01-01',
    'p-1,borrower-a,USD,1,2025-01-02',
  ]) {
    for (const rows of [[original, conflicting, original], [conflicting, original, original]]) {
      const result = domain.parseExposureCSV([header, ...rows, 'p-ok,borrower-a,USD,3,2025-01-01'].join('\n'), entities);
      assert.deepEqual(result.positions.map(p => p.positionId), ['p-ok']);
      assert.equal(result.duplicates, 2);
      assert.match(result.errors.join(' '), /conflicting.*p-1/i);
    }
  }
});

test('aggregates each position once per currency with exact large totals and entity filters', () => {
  const positions = domain.parseExposureCSV(`${header}\np-1,borrower-a,USD,9007199254740993.01,2025-01-01\np-2,borrower-a,USD,0.09,2025-01-01\np-3,borrower-b,EUR,10,2025-01-01\np-4,borrower-b,GBP,0,2025-01-01`, entities).positions;
  assert.deepEqual(domain.aggregateExposure([...positions, positions[0]]), { USD: '900719925474099310', EUR: '1000', GBP: '0' });
  assert.deepEqual(domain.aggregateExposure(positions, ['borrower-a', 'borrower-a']), { USD: '900719925474099310' });
  assert.deepEqual(domain.aggregateExposure(positions, []), {});
  assert.deepEqual(domain.aggregateExposure([], ['borrower-a']), {});
});

test('aggregate rejects conflicting duplicate IDs instead of silently choosing exposure', () => {
  const base = { positionId: 'p-1', entityId: 'borrower-a', currency: 'USD', amountMinor: '100', asOf: '2025-01-01' };
  for (const change of [{ amountMinor: '101' }, { entityId: 'borrower-b' }, { currency: 'EUR' }, { asOf: '2025-01-02' }]) {
    const other = { ...base, ...change };
    assert.throws(() => domain.aggregateExposure([base, other]), /conflicting.*p-1/i);
    assert.throws(() => domain.aggregateExposure([other, base], ['borrower-a']), /conflicting.*p-1/i);
  }
});

test('rejects malformed minor units and currencies even when aggregation bypasses import', () => {
  const base = { positionId: 'p-1', entityId: 'borrower-a', currency: 'USD', amountMinor: '100', asOf: '2025-01-01' };
  for (const amountMinor of [9007199254740993, 1.1, '-1', '+1', '1.1', '1e3', ' 1', '', null, undefined]) {
    assert.throws(() => domain.aggregateExposure([{ ...base, amountMinor }]), /minor/i);
  }
  for (const currency of ['JPY', '__proto__', 'usd', '']) {
    assert.throws(() => domain.aggregateExposure([{ ...base, currency }]), /currency/i);
  }
  assert.throws(() => domain.aggregateExposure([{ ...base, positionId: '' }]), /position_id/i);
  assert.throws(() => domain.aggregateExposure([{ ...base, asOf: '2025-02-29' }]), /as_of/i);
});

test('formats exact fixed-point currency without Number conversion or locale rounding', () => {
  assert.equal(domain.formatMoney('900719925474099301', 'INR'), 'INR 9,007,199,254,740,993.01');
  assert.equal(domain.formatMoney('0', 'USD'), 'USD 0.00');
  assert.equal(domain.formatMoney('1', 'EUR'), 'EUR 0.01');
  assert.equal(domain.formatMoney('120', 'GBP'), 'GBP 1.20');
  assert.throws(() => domain.formatMoney(1.01, 'USD'), /minor/i);
  assert.throws(() => domain.formatMoney('100', 'JPY'), /currency/i);
});

test('resolves only full normalized names or explicit aliases', () => {
  for (const name of ['acme credit limited', '  ACME   CREDIT  ', 'Ａｃｍｅ Credit']) {
    const result = domain.resolveEntity(name, entities);
    assert.equal(result.status, 'matched');
    assert.equal(result.entityId, 'borrower-a');
    assert.deepEqual(result.candidates, [entities[0]]);
  }
  for (const name of ['Acme', 'Acme Credit Ltd', 'Acme Credit Limited subsidiary', '', '  ', null]) {
    assert.deepEqual(domain.resolveEntity(name, entities), { status: 'unresolved', entityId: null, candidates: [] });
  }
});

test('keeps alias collisions ambiguous with candidates sorted by entity ID', () => {
  const collision = { ...entities[1], aliases: ['Acme Credit', 'Acme Credit Limited'] };
  const result = domain.resolveEntity('Acme Credit Limited', [collision, entities[0], entities[0]]);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.entityId, null);
  assert.deepEqual(result.candidates.map(entity => entity.id), ['borrower-a', 'borrower-b']);
  assert.deepEqual(result, domain.resolveEntity('Acme Credit Limited', [entities[0], collision]));
});

test('links an approved risk only to its explicit subject, never the document issuer or graph neighbours', () => {
  const positions = domain.parseExposureCSV(`${header}\np-a,borrower-a,USD,100,2025-01-01\np-b,borrower-b,USD,900,2025-01-01`, entities).positions;
  const event = { id: 'e-1', entityId: 'borrower-a', documentIssuerId: 'borrower-b', type: 'default', title: 'Missed payment', eventDate: '2025-01-01', status: 'approved', relatedEntityIds: ['borrower-b'] };
  const before = JSON.stringify({ event, positions, entities });
  const [item] = domain.buildReviewQueue([event], [...positions, positions[0]], entities);
  assert.equal(item.entityName, 'Acme Credit Limited');
  assert.deepEqual(item.exposure, { USD: '10000' });
  assert.equal(item.priority, 'high');
  assert.match(item.reason, /approved.*direct/i);
  assert.equal(item.documentIssuerId, 'borrower-b');
  assert.equal(JSON.stringify({ event, positions, entities }), before);
});

test('excludes dismissed evidence and leaves unknown subjects unlinked even if issuer has exposure', () => {
  const positions = domain.parseExposureCSV(`${header}\np-a,borrower-a,USD,100,2025-01-01`, entities).positions;
  const base = { id: 'e-1', entityId: 'borrower-a', documentIssuerId: 'borrower-a', type: 'default', status: 'approved', eventDate: '2025-01-01' };
  assert.deepEqual(domain.buildReviewQueue([{ ...base, status: 'dismissed' }], positions, entities), []);
  for (const entityId of [null, undefined, '', 'unknown']) {
    const [item] = domain.buildReviewQueue([{ ...base, entityId }], positions, entities);
    assert.equal(item.priority, 'low');
    assert.equal(item.entityName, 'Unresolved subject');
    assert.deepEqual(item.exposure, {});
    assert.match(item.reason, /subject.*(unresolved|unknown)/i);
  }
});

test('candidate risk evidence requires attribution review and never receives high priority', () => {
  const positions = domain.parseExposureCSV(`${header}\np-a,borrower-a,USD,100,2025-01-01`, entities).positions;
  const base = { id: 'e-1', entityId: 'borrower-a', type: 'default', eventDate: '2025-01-01' };
  for (const status of ['candidate', undefined, 'unrecognized']) {
    const [item] = domain.buildReviewQueue([{ ...base, status }], positions, entities);
    assert.equal(item.priority, 'medium');
    assert.deepEqual(item.exposure, { USD: '10000' });
    assert.match(item.reason, /attribution review/i);
  }
});

test('prioritizes only explicit material-risk types while redemption and unknown types stay low', () => {
  const positions = domain.parseExposureCSV(`${header}\np-a,borrower-a,USD,100,2025-01-01`, entities).positions;
  for (const type of ['default', 'payment_default', 'insolvency', 'bankruptcy', 'rating_downgrade', 'governance_concern', 'investigation', 'expected_npa']) {
    for (const status of ['approved', 'candidate']) {
      const [item] = domain.buildReviewQueue([{ id: 'e-1', entityId: 'borrower-a', type, status }], positions, entities);
      assert.equal(item.priority, status === 'approved' ? 'high' : 'medium', type);
    }
  }
  for (const type of ['redemption', 'repayment', 'rating_upgrade', 'unknown', 'not_a_default']) {
    for (const status of ['approved', 'candidate']) {
      const [item] = domain.buildReviewQueue([{ id: 'e-1', entityId: 'borrower-a', type, status }], positions, entities);
      assert.equal(item.priority, 'low', type);
      assert.deepEqual(item.exposure, { USD: '10000' });
      assert.match(item.reason, /not.*material-risk/i);
      if (status === 'candidate') assert.match(item.reason, /attribution review/i);
    }
  }
});

test('no positive direct exposure means low priority without cross-currency thresholds', () => {
  const event = { id: 'e-1', entityId: 'borrower-a', type: 'expected_npa', status: 'approved' };
  const zero = domain.parseExposureCSV(`${header}\np-a,borrower-a,USD,0,2025-01-01\np-b,borrower-b,USD,500,2025-01-01`, entities).positions;
  for (const positions of [[], zero]) {
    for (const status of ['approved', 'candidate']) {
      const [item] = domain.buildReviewQueue([{ ...event, status }], positions, entities);
      assert.equal(item.priority, 'low');
      assert.match(item.reason, /no positive direct exposure/i);
      if (status === 'candidate') assert.match(item.reason, /attribution review/i);
    }
  }
  const cent = domain.parseExposureCSV(`${header}\np-a,borrower-a,GBP,0.01,2025-01-01`, entities).positions;
  assert.equal(domain.buildReviewQueue([event], cent, entities)[0].priority, 'high');
});

test('sorts the review queue by priority, dated evidence newest first, then stable ID', () => {
  const positions = domain.parseExposureCSV(`${header}\np-a,borrower-a,USD,1,2025-01-01`, entities).positions;
  const base = { entityId: 'borrower-a', type: 'default', status: 'approved' };
  const events = [
    { ...base, id: 'e-low', type: 'redemption', eventDate: '2025-01-05' },
    { ...base, id: 'e-medium', status: 'candidate', eventDate: '2025-01-04' },
    { ...base, id: 'e-z', eventDate: '2025-01-02' },
    { ...base, id: 'e-old', eventDate: '2025-01-01' },
    { ...base, id: 'e-a', eventDate: '2025-01-02' },
  ];
  const expected = ['e-a', 'e-z', 'e-old', 'e-medium', 'e-low'];
  assert.deepEqual(domain.buildReviewQueue(events, positions, entities).map(e => e.id), expected);
  assert.deepEqual(domain.buildReviewQueue([...events].reverse(), positions, entities).map(e => e.id), expected);
  assert.equal(events[0].id, 'e-low');
});

test('exports a source-linked dated brief with exact separate currencies and explicit limitations', () => {
  const item = {
    id: 'e-1', title: 'Borrower evidence', entityId: 'borrower-a', entityName: 'Acme Credit Limited',
    type: 'expected_npa', status: 'candidate', priority: 'medium', reason: 'Attribution review required.',
    summary: 'A historical expectation, not a current loss finding.', quote: 'Acme Credit may enter the NPA category.',
    eventDate: '2025-01-02', publishedAt: '2025-01-03', firstSeenAt: '2025-02-01T10:00:00Z',
    sourceTitle: 'Synthetic public disclosure', sourceUrl: 'https://example.com/report.pdf', page: 3,
    historical: true, extractionMethod: 'Human-curated source', exposure: { USD: '900719925474099301', EUR: '100' },
  };
  const brief = domain.exportBrief(item);
  for (const expected of [item.title, item.entityName, item.summary, item.quote, item.sourceTitle, item.sourceUrl, item.eventDate, item.publishedAt, item.firstSeenAt, item.reason, item.extractionMethod]) assert.ok(brief.includes(expected), expected);
  assert.match(brief, /Page: 3/);
  assert.match(brief, /USD 9,007,199,254,740,993\.01/);
  assert.match(brief, /EUR 1\.00/);
  assert.match(brief, /historical/i);
  assert.match(brief, /candidate/i);
  assert.match(brief, /not financial advice/i);
  assert.match(brief, /no predicted loss/i);
  assert.match(brief, /no FX conversion/i);
  assert.match(brief, /no contagion/i);
  assert.equal(domain.exportBrief(item), brief);
});

test('does not accept a quoted trailing newline as numeric or calendar data', () => {
  for (const newline of ['\n', '\r', '\r\n']) {
    const amount = domain.parseExposureCSV(`${header}\np-a,borrower-a,USD,"1${newline}",2025-01-01`, entities);
    assert.deepEqual(amount.positions, []);
    assert.match(amount.errors.join(' '), /amount/i);
    const date = domain.parseExposureCSV(`${header}\np-a,borrower-a,USD,1,"2025-01-01${newline}"`, entities);
    assert.deepEqual(date.positions, []);
    assert.match(date.errors.join(' '), /as_of/i);
    assert.throws(() => domain.formatMoney(`100${newline}`, 'USD'), /minor/i);
  }
});

test('brief labels unknown metadata and date precision instead of inventing exact dates', () => {
  const brief = domain.exportBrief({ id: 'e-unknown', exposure: {} });
  assert.doesNotMatch(brief, /undefined|null/);
  assert.match(brief, /Event date: Not provided/);
  assert.match(brief, /Published: Not provided/);
  assert.match(brief, /No linked nominal exposure/);
  assert.match(brief, /Source: Not provided/);
  assert.match(brief, /Historical replay: Not provided/);
  const month = domain.exportBrief({ id: 'e-month', eventDate: '2025-04-01', eventDatePrecision: 'month', exposure: {} });
  assert.match(month, /Event date: 2025-04 \(month precision\)/);
  assert.doesNotMatch(month, /2025-04-01/);
  const invalid = domain.exportBrief({ id: 'e-invalid', eventDate: '2025-02-29', publishedAt: '2025-02-29', exposure: {} });
  assert.match(invalid, /Event date: Invalid date/);
  assert.match(invalid, /Published: Invalid date/);
});

test('quarantines duplicate IDs even when one occurrence has invalid financial data', () => {
  const original = 'p-1,borrower-a,USD,1,2025-01-01';
  for (const bad of [
    'p-1,borrower-a,USD,-2,2025-01-01',
    'p-1,unknown,USD,1,2025-01-01',
    'p-1,borrower-a,USD,1,2025-02-29',
    'p-1,borrower-a,JPY,1,2025-01-01',
    'p-1,borrower-a,USD,1,2025-01-01,extra',
  ]) {
    for (const rows of [[original, bad], [bad, original]]) {
      const result = domain.parseExposureCSV([header, ...rows].join('\n'), entities);
      assert.deepEqual(result.positions, [], bad);
      assert.equal(result.duplicates, 1);
      assert.ok(result.errors.length > 0);
    }
  }
});

test('brief rejects malformed timestamps and never labels an invalid event date as precise evidence', () => {
  for (const value of ['2025-01-01junk', '2025-01-01T99:00:00Z', '2025-01-01T24:00:00Z', '2025-02-30T12:00:00Z']) {
    const brief = domain.exportBrief({ id: 'e-1', eventDate: value, publishedAt: value, firstSeenAt: value });
    assert.match(brief, /Event date: Invalid date/);
    assert.match(brief, /Published: Invalid date/);
    assert.match(brief, /First seen: Invalid date/);
  }
});

test('classifies backend negative outlook and liquidity stress candidates as reviewable risks', () => {
  const positions = domain.parseExposureCSV(`${header}\np-a,borrower-a,USD,1,2025-01-01`, entities).positions;
  for (const type of ['negative_outlook', 'liquidity_stress']) {
    for (const status of ['approved', 'candidate']) {
      const [item] = domain.buildReviewQueue([{ id: 'e-1', entityId: 'borrower-a', type, status }], positions, entities);
      assert.equal(item.priority, status === 'approved' ? 'high' : 'medium');
    }
  }
});

// Generic synthetic fixtures, never client holdings.
test('imports decimal holdings beyond safe Number precision exactly', () => {
  const csv = `${header}\np-1,borrower-a,INR,9007199254740993.01,2024-02-29\np-2,borrower-b,USD,0.1,2025-01-31`;
  assert.deepEqual(domain.parseExposureCSV(csv, entities), {
    positions: [
      { positionId: 'p-1', entityId: 'borrower-a', currency: 'INR', amountMinor: '900719925474099301', asOf: '2024-02-29' },
      { positionId: 'p-2', entityId: 'borrower-b', currency: 'USD', amountMinor: '10', asOf: '2025-01-31' },
    ], errors: [], duplicates: 0,
  });
});
