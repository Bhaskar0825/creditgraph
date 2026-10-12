import React, { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import { Focus, Minus, Plus, ArrowUpRight } from 'lucide-react';

export default function Graph({ entities, relationships, events, onSelect, compact = false }) {
  const container = useRef(null);
  const graph = useRef(null);
  const select = useRef(onSelect);
  const visibleIds = new Set(entities.map((entity) => entity.id));
  const visibleRelationships = relationships.filter((edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId));
  select.current = onSelect;
  useEffect(() => {
    const ids = new Set(entities.map((entity) => entity.id));
    const affected = new Set(events.filter((event) => event.status !== 'dismissed').map((event) => event.entityId));
    const cy = cytoscape({
      container: container.current,
      elements: [
        ...entities.map((entity) => ({ data: { id: entity.id, label: entity.name.replace(/ Limited| Ltd\.?| Corporation/g, '').replace(/\s/g, '\n'), affected: affected.has(entity.id) ? 1 : 0, issuer: events.some((event) => event.documentIssuerId === entity.id) ? 1 : 0 } })),
        ...relationships.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId)).map((edge, index) => ({ data: { id: `edge-${edge.id || index}`, source: edge.sourceId, target: edge.targetId, label: (edge.type || 'relationship').replaceAll('_', ' ') } })),
      ],
      style: [
        { selector: 'node', style: { 'background-color': '#137b73', width: compact ? 29 : 42, height: compact ? 29 : 42, 'border-width': 6, 'border-color': '#dcefeb', label: 'data(label)', 'text-wrap': 'wrap', 'text-max-width': 110, 'font-family': 'Arial, sans-serif', 'font-size': compact ? 10 : 12, 'font-weight': 600, color: '#293d4b', 'text-valign': 'bottom', 'text-margin-y': 10 } },
        { selector: 'node[affected = 1]', style: { 'background-color': '#d39733', 'border-color': '#f7ebd5' } },
        { selector: 'node[issuer = 1]', style: { 'background-color': '#263e54', 'border-color': '#e1e8ed' } },
        { selector: 'edge', style: { width: 1.5, 'line-color': '#b6c8cb', 'target-arrow-color': '#b6c8cb', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: compact ? '' : 'data(label)', 'font-size': 9, 'text-rotation': 'autorotate', 'text-background-color': '#f8faf9', 'text-background-opacity': 1, 'text-background-padding': 3, color: '#71828b' } },
        { selector: 'node:selected', style: { 'border-color': '#88bfb5', 'border-width': 9 } },
      ],
      layout: { name: 'circle', padding: compact ? 48 : 70, startAngle: -Math.PI / 2, avoidOverlap: true },
      minZoom: 0.35, maxZoom: 2.4,
      userZoomingEnabled: !compact, userPanningEnabled: !compact,
    });
    graph.current = cy;
    cy.on('tap', 'node', (event) => select.current(event.target.id()));
    const observer = new ResizeObserver(() => { cy.resize(); cy.fit(undefined, compact ? 48 : 70); });
    observer.observe(container.current);
    return () => { observer.disconnect(); cy.destroy(); graph.current = null; };
  }, [entities, relationships, events, compact]);

  return <div className={`graph-module ${compact ? 'compact' : ''}`}>
    <div className="graph-canvas" ref={container} role="img" aria-label="Evidence relationship graph. Use the company buttons and relationship list below for keyboard access." />
    {!compact && <div className="graph-tools" aria-label="Graph controls">
      <button className="icon-button" aria-label="Zoom in graph" onClick={() => graph.current?.zoom(graph.current.zoom() * 1.2)}><Plus size={16} /></button>
      <button className="icon-button" aria-label="Zoom out graph" onClick={() => graph.current?.zoom(graph.current.zoom() / 1.2)}><Minus size={16} /></button>
      <button className="icon-button" aria-label="Fit graph" onClick={() => graph.current?.fit(undefined, 70)}><Focus size={16} /></button>
    </div>}
    <div className="graph-legend"><span><i className="legend-dot teal" />Company</span><span><i className="legend-dot amber" />Event subject</span><span><i className="legend-dot navy" />Rated / report entity</span></div>
    <details className="graph-accessible" open={!compact}>
      <summary>Explore companies & source-linked relationships</summary>
      <div className="entity-chips">{entities.map((entity) => <button key={entity.id} onClick={() => onSelect(entity.id)}>{entity.name}<ArrowUpRight size={12} /></button>)}</div>
      {!compact && <ul className="edge-list">{visibleRelationships.map((edge) => <li key={edge.id}>
        <span><strong>{entities.find((e) => e.id === edge.sourceId)?.name || edge.sourceId}</strong> <span className="muted">→ {(edge.type || 'relationship').replaceAll('_', ' ')} →</span> <strong>{entities.find((e) => e.id === edge.targetId)?.name || edge.targetId}</strong></span>
        {edge.quote && <q>{edge.quote}</q>}
        {/^https?:\/\//.test(edge.sourceUrl || '') && <a href={edge.sourceUrl} target="_blank" rel="noreferrer">View relationship source <ArrowUpRight size={12} /></a>}
      </li>)}{!visibleRelationships.length && <li>No documented relationships in this view.</li>}</ul>}
    </details>
  </div>;
}
