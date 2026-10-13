import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Controls, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowUpRight } from 'lucide-react';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { buildGraphLayout } from './graph-layout.js';

const fitOptions = { padding: 0.12, minZoom: 0.85, maxZoom: 1 };
const nodeStyle = { background: '#fff', color: '#000', border: '2px solid #000', borderRadius: 8, padding: 16, textAlign: 'left', boxShadow: 'none', fontSize: 18 };

export default function Graph({ entities = [], relationships = [], events = [], onSelect, compact = false }) {
  const container = useRef(null);
  const [flow, setFlow] = useState(null);
  const model = useMemo(() => buildGraphLayout({ entities, relationships, events, compact }), [entities, relationships, events, compact]);
  const names = useMemo(() => new Map(entities.map((entity) => [entity.id, entity.name])), [entities]);
  const nodes = useMemo(() => model.nodes.map((node) => ({
    ...node,
    type: 'default',
    draggable: false,
    connectable: false,
    deletable: false,
    focusable: true,
    ariaLabel: `${node.data.name}. ${node.data.role}. Open company profile.`,
    domAttributes: {
      onKeyDown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(node.id);
        }
      },
    },
    style: { ...nodeStyle, width: node.width, height: node.height },
    data: { ...node.data, label: <div style={{ display: 'flex', flexDirection: 'column', gap: 5, overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
      <strong style={{ fontSize: 18, lineHeight: '24px' }}>{node.data.name}</strong>
      <span style={{ fontSize: 14, lineHeight: '20px' }}>{node.data.role}</span>
      {node.data.eventSubject && <span style={{ fontSize: 14, lineHeight: '18px', fontWeight: 600 }}>Event subject</span>}
      {node.data.documentEntity && <span style={{ fontSize: 14, lineHeight: '18px', fontWeight: 600 }}>Rated / report entity</span>}
    </div> },
  })), [model, onSelect]);
  const edges = useMemo(() => model.edges.map((edge) => ({
    ...edge,
    type: 'smoothstep',
    animated: false,
    deletable: false,
    reconnectable: false,
    selectable: false,
    focusable: false,
    markerEnd: { type: MarkerType.ArrowClosed, color: '#ccc', width: 20, height: 20 },
    style: { stroke: '#ccc', strokeWidth: 2 },
    labelStyle: { fill: '#000', fontSize: 16, fontWeight: 600 },
    labelBgStyle: { fill: '#fff', fillOpacity: 1 },
    labelBgPadding: [8, 6],
    labelBgBorderRadius: 3,
  })), [model]);

  useEffect(() => {
    if (!flow || !container.current) return undefined;
    let frame;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => flow.fitView(fitOptions));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [flow, model]);

  return <div className={`graph-module ${compact ? 'compact' : ''}`}>
    {!entities.length ? <div className="graph-empty" role="status" style={{ padding: 32, color: '#000', background: '#fff', fontSize: 18 }}>
      <strong>No companies match this view.</strong>
      <p>Clear your search or change the filters to explore documented relationships.</p>
    </div> : <>
      <div className="graph-canvas" ref={container} aria-label="Documented company relationships" style={{ background: '#000', color: '#fff' }}>
        <ReactFlow
          nodes={nodes} edges={edges} onInit={setFlow}
          onNodeClick={(_, node) => onSelect(node.id)}
          nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false}
          deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}
          nodesFocusable edgesFocusable={false}
          minZoom={0.3} maxZoom={2} fitView fitViewOptions={fitOptions}
          colorMode="dark" attributionPosition="bottom-right"
        >
          <Controls showInteractive={false} fitViewOptions={fitOptions} position="top-right" />
        </ReactFlow>
      </div>
      <p className="graph-legend" style={{ color: '#bbb', fontSize: 14 }}>Arrows show documented relationships, not transferred risk. Pan to explore; use + / − to zoom. Select a company to open its profile.</p>
      <Accordion type="single" collapsible className="graph-accessible" defaultValue={compact ? undefined : 'relationships'}><AccordionItem value="relationships"><AccordionTrigger>Explore companies &amp; source-linked relationships</AccordionTrigger><AccordionContent>
        <div className="entity-chips">{entities.map((entity) => <Button variant="outline" key={entity.id} onClick={() => onSelect(entity.id)}>{entity.name}<ArrowUpRight size={14} /></Button>)}</div>
        <ul className="edge-list">{model.relationships.map((edge, index) => <li key={edge.id || index}>
          <span><strong>{names.get(edge.sourceId)}</strong> → {(edge.type || 'relationship').replaceAll('_', ' ')} → <strong>{names.get(edge.targetId)}</strong></span>
          {edge.quote && <q>{edge.quote}</q>}
          {/^https?:\/\//.test(edge.sourceUrl || '') && <a href={edge.sourceUrl} target="_blank" rel="noreferrer">{edge.sourceTitle || 'View relationship source'} <ArrowUpRight size={16} /></a>}
        </li>)}{!model.relationships.length && <li>No documented relationships in this view.</li>}</ul>
      </AccordionContent></AccordionItem></Accordion>
    </>}
  </div>;
}
