// Pure local portfolio and evidence domain functions. No network or storage access.
const CURRENCIES = new Set(['INR', 'USD', 'EUR', 'GBP']);
// Explicit evidence categories, not a model-derived credit score.
const MATERIAL_RISKS = new Set(['default', 'payment_default', 'insolvency', 'bankruptcy', 'rating_downgrade', 'governance_concern', 'investigation', 'expected_npa', 'negative_outlook', 'liquidity_stress']);

function csvRecords(text) {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (closed && ![',', '\r', '\n'].includes(char)) throw new Error('CSV has text after a closing quote.');
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (quoted) { quoted = false; closed = true; }
      else if (field === '') quoted = true;
      else throw new Error('CSV has a quote inside an unquoted field.');
    } else if (char === ',' && !quoted) {
      row.push(field); field = ''; closed = false;
    } else if ((char === '\r' || char === '\n') && !quoted) {
      row.push(field); rows.push(row); row = []; field = ''; closed = false;
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else field += char;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  if (field || row.length || closed) { row.push(field); rows.push(row); }
  return rows;
}

function exactMinor(value) {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) throw new Error('amountMinor must be a nonnegative integer string in minor units.');
  return BigInt(value);
}

export function aggregateExposure(positions, entityIds) {
  const selected = entityIds === undefined ? null : new Set(entityIds);
  const seen = new Map(), totals = {};
  for (const position of positions) {
    if (typeof position.positionId !== 'string' || !position.positionId.trim()) throw new Error('position_id is required.');
    if (!CURRENCIES.has(position.currency)) throw new Error('Unsupported currency; use INR, USD, EUR or GBP.');
    if (!validDate(position.asOf)) throw new Error('as_of must be a valid YYYY-MM-DD calendar date.');
    const minor = exactMinor(position.amountMinor);
    if (seen.has(position.positionId)) {
      if (!samePosition(seen.get(position.positionId), position)) throw new Error(`Conflicting duplicate position_id ${position.positionId}.`);
      continue;
    }
    seen.set(position.positionId, position);
    if (selected && !selected.has(position.entityId)) continue;
    totals[position.currency] = (BigInt(totals[position.currency] || '0') + minor).toString();
  }
  return totals;
}

export function formatMoney(minor, currency) {
  if (!CURRENCIES.has(currency)) throw new Error('Unsupported currency; use INR, USD, EUR or GBP.');
  const value = exactMinor(minor);
  const whole = (value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (value % 100n).toString().padStart(2, '0');
  return `${currency} ${whole}.${fraction}`;
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizedName(name) {
  return typeof name === 'string' ? name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

export function resolveEntity(name, entities) {
  const normalized = normalizedName(name);
  const matches = normalized ? entities.filter(entity => [entity.name, ...(entity.aliases || [])].some(alias => normalizedName(alias) === normalized)) : [];
  const candidates = [...new Map(matches.map(entity => [entity.id, entity])).values()].sort((a, b) => compareText(a.id, b.id));
  return {
    status: candidates.length === 1 ? 'matched' : candidates.length ? 'ambiguous' : 'unresolved',
    entityId: candidates.length === 1 ? candidates[0].id : null,
    candidates,
  };
}

export function buildReviewQueue(events, positions, entities) {
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return events.filter(event => event.status !== 'dismissed').map(event => {
    const entity = entities.find(entity => entity.id === event.entityId);
    if (!entity) return { ...event, entityName: 'Unresolved subject', exposure: {}, priority: 'low', reason: 'Event subject is unresolved or unknown; no exposure linked. Attribution review required.' };
    const exposure = aggregateExposure(positions, [event.entityId]);
    const approved = event.status === 'approved';
    if (!Object.values(exposure).some(minor => BigInt(minor) > 0n)) return { ...event, entityName: entity.name, exposure, priority: 'low', reason: `No positive direct exposure to the explicit event subject.${approved ? '' : ' Candidate evidence needs attribution review.'}` };
    if (!MATERIAL_RISKS.has(event.type)) return { ...event, entityName: entity.name, exposure, priority: 'low', reason: `Event type is not a classified material-risk signal.${approved ? '' : ' Candidate evidence needs attribution review.'}` };
    return { ...event, entityName: entity.name, exposure, priority: approved ? 'high' : 'medium', reason: approved ? 'Approved material-risk evidence with direct nominal exposure.' : 'Candidate evidence needs attribution review before approval; direct nominal exposure is not a loss estimate.' };
  }).sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
    || compareText(validDate(b.eventDate) ? b.eventDate : '', validDate(a.eventDate) ? a.eventDate : '')
    || compareText(a.id, b.id));
}

function provided(value) {
  return value === undefined || value === null || value === '' ? 'Not provided' : String(value);
}

function briefDate(value, precision) {
  if (value === undefined || value === null || value === '') return 'Not provided';
  if (typeof value !== 'string' || !validDate(value.slice(0, 10))) return 'Invalid date — verify source';
  if (value.length !== 10 && !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return 'Invalid date — verify source';
  if (precision === 'month') return `${value.slice(0, 7)} (month precision)`;
  return value;
}

export function exportBrief(item) {
  const exposure = item.exposure || {};
  const amounts = Object.keys(exposure).sort().map(currency => formatMoney(exposure[currency], currency));
  return [
    'CREDITGRAPH — EVIDENCE REVIEW BRIEF',
    provided(item.title),
    `Event ID: ${provided(item.id)}`,
    `Subject: ${provided(item.entityName)} (${provided(item.entityId)})`,
    `Evidence type: ${provided(item.type)}`,
    `Review status: ${provided(item.status)} | Priority: ${provided(item.priority)}`,
    `Event date: ${briefDate(item.eventDate, item.eventDatePrecision)}`,
    `Published: ${briefDate(item.publishedAt)}`,
    `First seen: ${briefDate(item.firstSeenAt)}`,
    `Historical replay: ${item.historical === true ? 'yes — not a live alert' : item.historical === false ? 'no' : 'Not provided'}`,
    `Extraction method: ${provided(item.extractionMethod)}`,
    '', 'SUMMARY', provided(item.summary),
    '', 'EXACT SOURCE QUOTE', provided(item.quote),
    `Source: ${provided(item.sourceTitle)}`,
    `URL: ${provided(item.sourceUrl)}`,
    `Page: ${provided(item.page)}`,
    '', 'DIRECT NOMINAL EXPOSURE',
    ...(amounts.length ? amounts : ['No linked nominal exposure.']),
    '', `Review reason: ${provided(item.reason)}`,
    '', 'LIMITATIONS',
    'Not financial advice. No predicted loss: nominal exposure is not expected loss.',
    'Currencies are reported separately; no FX conversion.',
    'Explicit event subject only; no contagion inferred through document issuers or graph relationships.',
    'Candidate evidence requires human attribution review; approval does not establish current credit status.',
  ].join('\n');
}

function samePosition(a, b) {
  return a.entityId === b.entityId && a.currency === b.currency && a.amountMinor === b.amountMinor && a.asOf === b.asOf;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export function parseExposureCSV(text, entities) {
  let rows;
  try { rows = csvRecords(text.replace(/^\uFEFF/, '')); }
  catch (error) { return { positions: [], errors: [error.message], duplicates: 0 }; }
  const expectedHeader = ['position_id', 'entity_id', 'currency', 'amount', 'as_of'];
  const header = rows.shift();
  if (!header || header.length !== expectedHeader.length || header.some((cell, i) => cell !== expectedHeader[i])) {
    return { positions: [], errors: ['CSV header must be position_id,entity_id,currency,amount,as_of.'], duplicates: 0 };
  }
  const positions = [], errors = [];
  const seen = new Map(), conflicts = new Set(), identifiers = new Set();
  let duplicates = 0;
  const knownEntities = new Set(entities.map(entity => entity.id));
  rows.forEach((row, index) => {
    if (row.length === 1 && row[0] === '') return;
    const [positionId, entityId, currency, amount, asOf] = row;
    if (positionId.trim()) {
      if (identifiers.has(positionId)) duplicates++;
      identifiers.add(positionId);
    }
    const reject = message => {
      errors.push(`Row ${index + 2}: ${message}`);
      conflicts.add(positionId);
    };
    if (row.length !== 5) {
      reject('expected exactly five fields.');
      return;
    }
    if (!positionId.trim()) {
      reject('position_id is required.');
      return;
    }
    if (!knownEntities.has(entityId)) {
      reject('entity_id is unknown; use an exact known entity ID.');
      return;
    }
    if (!CURRENCIES.has(currency)) {
      reject('currency must be INR, USD, EUR or GBP.');
      return;
    }
    if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(amount)) {
      reject('amount must be nonnegative decimal text with at most two decimal places.');
      return;
    }
    if (!validDate(asOf)) {
      reject('as_of must be a valid YYYY-MM-DD calendar date.');
      return;
    }
    const [whole, fraction = ''] = amount.split('.');
    const amountMinor = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
    const position = { positionId, entityId, currency, amountMinor, asOf };
    if (seen.has(positionId)) {
      if (!samePosition(seen.get(positionId), position) && !conflicts.has(positionId)) {
        conflicts.add(positionId);
        errors.push(`Row ${index + 2}: conflicting duplicate position_id ${positionId}; all occurrences excluded.`);
      }
      return;
    }
    seen.set(positionId, position);
    positions.push(position);
  });
  return { positions: positions.filter(position => !conflicts.has(position.positionId)), errors, duplicates };
}
