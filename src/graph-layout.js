import dagre from '@dagrejs/dagre';

export function buildGraphLayout({ entities = [], relationships = [], events = [], compact = false }) {
  const ids = new Set(entities.map((entity) => entity.id));
  const subjects = new Set(events.filter((event) => event.status !== 'dismissed').map((event) => event.entityId));
  const documentEntities = new Set(events.map((event) => event.documentIssuerId));
  const visibleRelationships = relationships.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId));
  const layout = new dagre.graphlib.Graph({ multigraph: true }).setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: 'TB', nodesep: compact ? 32 : 56, ranksep: compact ? 78 : 100, marginx: 24, marginy: 24 });
  const nodes = entities.map((entity) => {
    const width = 280;
    const role = entity.role || 'Company';
    const eventSubject = subjects.has(entity.id);
    const documentEntity = documentEntities.has(entity.id);
    // Reserve wrapped-label space before layout so long legal names do not overlap.
    const height = Math.max(120, 46 + Math.ceil(entity.name.length / 21) * 24 + Math.ceil(role.length / 29) * 20 + (eventSubject ? 23 : 0) + (documentEntity ? 23 : 0));
    layout.setNode(entity.id, { width, height });
    return { id: entity.id, width, height, sourcePosition: 'bottom', targetPosition: 'top',
      data: { name: entity.name, role, eventSubject, documentEntity } };
  });
  visibleRelationships.forEach((edge, index) => layout.setEdge(edge.sourceId, edge.targetId, {}, String(index)));
  if (nodes.length) dagre.layout(layout);
  nodes.forEach((node) => {
    const position = layout.node(node.id);
    node.position = { x: position.x - node.width / 2, y: position.y - node.height / 2 };
  });
  return {
    nodes,
    edges: visibleRelationships.map((edge, index) => ({
      id: `relationship-${edge.id || index}`, source: edge.sourceId, target: edge.targetId,
      label: (edge.type || 'relationship').replaceAll('_', ' '),
    })),
    relationships: visibleRelationships,
  };
}
