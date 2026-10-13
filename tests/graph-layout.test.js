import test from 'node:test';
import assert from 'node:assert/strict';

const entities = [
  { id: 'lender', name: 'Example Finance Limited', role: 'Lender / rated entity' },
  { id: 'borrower', name: 'Example Engineering Limited', role: 'Borrower' },
  { id: 'subsidiary', name: 'Example Finance Subsidiary Limited', role: 'Subsidiary' },
];
const relationships = [
  { id: 'loan', sourceId: 'lender', targetId: 'borrower', type: 'finances' },
  { id: 'parent', sourceId: 'lender', targetId: 'subsidiary', type: 'parent_of' },
  { id: 'hidden', sourceId: 'borrower', targetId: 'missing', type: 'supplier_of' },
];

test('layout filters invisible endpoints and keeps literal relationship direction', async () => {
  const module = await import('../src/graph-layout.js').catch(() => ({}));
  assert.equal(typeof module.buildGraphLayout, 'function', 'graph layout implementation is required');
  const result = module.buildGraphLayout({ entities, relationships, events: [] });
  assert.deepEqual(result.edges.map(({ source, target, label }) => ({ source, target, label })), [
    { source: 'lender', target: 'borrower', label: 'finances' },
    { source: 'lender', target: 'subsidiary', label: 'parent of' },
  ]);
  assert.equal(result.relationships.length, 2);
});

test('roles and event subjects never spread to connected companies', async () => {
  const { buildGraphLayout } = await import('../src/graph-layout.js');
  const { nodes } = buildGraphLayout({ entities, relationships, events: [
    { entityId: 'borrower', documentIssuerId: 'lender', status: 'candidate' },
    { entityId: 'subsidiary', documentIssuerId: 'lender', status: 'dismissed' },
  ] });
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node.data]));
  assert.equal(byId.borrower.role, 'Borrower');
  assert.equal(byId.borrower.eventSubject, true);
  assert.equal(byId.borrower.documentEntity, false);
  assert.equal(byId.lender.role, 'Lender / rated entity');
  assert.equal(byId.lender.eventSubject, false);
  assert.equal(byId.lender.documentEntity, true);
  assert.equal(byId.subsidiary.role, 'Subsidiary');
  assert.equal(byId.subsidiary.eventSubject, false);
  assert.equal(byId.subsidiary.documentEntity, false);
  assert.equal(byId.lender.name, entities[0].name);
});

test('Dagre positions have readable dimensions and no overlapping company boxes', async () => {
  const { buildGraphLayout } = await import('../src/graph-layout.js');
  for (const compact of [false, true]) {
    const { nodes } = buildGraphLayout({ entities, relationships, compact });
    for (const node of nodes) {
      assert.ok(Number.isFinite(node.position?.x), 'Dagre must position each company');
      assert.ok(Number.isFinite(node.position?.y));
      assert.ok(node.width >= 260);
      assert.ok(node.height >= 100);
      for (const other of nodes.filter((candidate) => candidate.id !== node.id)) {
        const overlaps = node.position.x < other.position.x + other.width &&
          node.position.x + node.width > other.position.x &&
          node.position.y < other.position.y + other.height &&
          node.position.y + node.height > other.position.y;
        assert.equal(overlaps, false);
      }
    }
    assert.equal(nodes[0].sourcePosition, 'bottom');
  }
  assert.deepEqual(buildGraphLayout({ entities: [], relationships, events: [] }), { nodes: [], edges: [], relationships: [] });
});

test('long company names reserve enough height for both evidence labels', async () => {
  const { buildGraphLayout } = await import('../src/graph-layout.js');
  const { nodes } = buildGraphLayout({ entities: [{ id: 'example', name: 'Example Renewable Infrastructure Finance Limited', role: 'Lender / rated entity' }], events: [{ entityId: 'example', documentIssuerId: 'example' }] });
  assert.ok(nodes[0].height >= 180, 'wrapped legal name plus role and two labels must fit');
});
