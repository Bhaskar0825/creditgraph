import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Overview } from '@/components/overview';
import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Building2, Check, CheckCheck, ChevronRight, CircleHelp, Database, FileSearch, FileText, Filter, Globe2, History, LayoutDashboard, Link2, LoaderCircle, LockKeyhole, Menu, Network, RefreshCw, Search, ShieldCheck, Upload, Wallet, X } from 'lucide-react';
import { aggregateExposure, buildReviewQueue, exportBrief, formatMoney, parseExposureCSV } from './domain.js';
import { sampleData, SAMPLE_CSV } from './sample-data.js';
import { createCloudClient, hydrateWorkspace, mergeExposureImport } from './api.js';
const LazyGraph = lazy(() => import('./Graph.jsx'));
function Graph(props) {
  return <Suspense fallback={<div className="empty-state" role="status">Loading evidence graph…</div>}><LazyGraph {...props} /></Suspense>;
}
const navigation = [{
  id: 'overview',
  title: 'Overview',
  icon: LayoutDashboard
}, {
  id: 'exposure',
  title: 'Exposure book',
  icon: Wallet
}, {
  id: 'graph',
  title: 'Evidence graph',
  icon: Network
}, {
  id: 'review',
  title: 'Review queue',
  icon: FileSearch
}, {
  id: 'sources',
  title: 'Sources',
  icon: Database
}];
const pageCopy = {
  overview: ['Your credit picture. Connected.', 'Follow the evidence. Understand what matters to your book.'],
  exposure: ['Your book, kept private.', 'Map positions to legal entities. Amounts stay in this browser tab.'],
  graph: ['See the relationships behind the risk.', 'Documented connections, not assumed contagion or predicted losses.'],
  review: ['Evidence before conviction.', 'Check the subject, read the source, and record an analyst decision.'],
  sources: ['Every signal starts with a source.', 'Collect public documents and turn exact evidence into review candidates.']
};
const statusLabel = {
  candidate: 'Needs review',
  approved: 'Reviewed',
  dismissed: 'Dismissed'
};
const pretty = (value = '') => String(value).replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()).replace(/\bNpa\b/g, 'NPA');
const eventDateLabel = item => item.eventDatePrecision === 'month' && item.eventDate ? new Date(item.eventDate).toLocaleDateString('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC'
}) + ' (month only)' : item.eventDate ? dateLabel(item.eventDate) : item.publishedAt ? `Published ${dateLabel(item.publishedAt)}` : 'Event date not stated';
const dateLabel = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleDateString('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
}) : 'Not stated';
const validLink = value => /^https?:\/\//i.test(value || '');
function download(name, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], {
    type: `${type};charset=utf-8`
  }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Money({
  amounts,
  empty = 'No direct exposure'
}) {
  const entries = Object.entries(amounts || {});
  return entries.length ? <span className="money-stack">{entries.map(([currency, amount]) => <span key={currency}>{formatMoney(amount, currency)}</span>)}</span> : <span className="muted">{empty}</span>;
}
function Status({
  status
}) {
  return <Badge className={`badge ${status === 'approved' ? 'green' : status === 'dismissed' ? 'gray' : 'amber'}`} variant="outline"><i />{statusLabel[status] || pretty(status)}</Badge>;
}
function Empty({
  title = 'Nothing in this view',
  children
}) {
  return <div className="empty-state"><FileSearch size={27} /><h3>{title}</h3><p>{children || 'Try a different search or filter.'}</p></div>;
}
function SourceLink({
  url,
  children = 'Open original source'
}) {
  return validLink(url) ? <a className="source-link" href={url} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={14} /></a> : <span className="muted">Source link unavailable</span>;
}
function EventTable({
  items,
  onSelect,
  compact = false
}) {
  if (!items.length) return <Empty title="No matching evidence">No events match this view. Clear filters or add a public source.</Empty>;
  return <div className="table-scroll"><Table className="event-table"><TableHeader><TableRow><TableHead>Company / evidence</TableHead><TableHead>Event type</TableHead><TableHead>Direct exposure</TableHead><TableHead>Review status</TableHead><TableHead><span className="sr-only">Open</span></TableHead></TableRow></TableHeader>
    <TableBody>{items.slice(0, compact ? 5 : undefined).map(item => <TableRow key={item.id}>
      <TableCell><Button variant="ghost" className="event-open" onClick={() => onSelect(item.id)}><span className={`company-icon ${item.priority === 'high' ? 'warm' : ''}`}><Building2 size={17} /></span><span><strong>{item.entityName || 'Unresolved subject'}</strong><span>{item.title}</span><small>{eventDateLabel(item)}{item.historical ? ' · Historical' : ''}</small></span></Button></TableCell>
      <TableCell><span className="type-label">{pretty(item.type || 'Public disclosure')}</span></TableCell>
      <TableCell className="numeric"><Money amounts={item.exposure} /></TableCell>
      <TableCell><Status status={item.status} /></TableCell>
      <TableCell><Button variant="ghost" className="icon-button" aria-label={`Review ${item.title}`} onClick={() => onSelect(item.id)}><ArrowUpRight size={17} /></Button></TableCell>
    </TableRow>)}</TableBody></Table></div>;
}
function Drawer({
  children,
  title,
  onClose
}) {
  const opener = useRef(document.activeElement);
  return <Sheet open onOpenChange={open => { if (!open) onClose(); }}><SheetContent className="detail-sheet w-full sm:max-w-[600px]" aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus(); }}><SheetHeader className="border-b"><SheetTitle>{title}</SheetTitle></SheetHeader>{children}</SheetContent></Sheet>;
}
function EventDetail({
  item,
  entities,
  mode,
  busy,
  onDecision,
  onClose,
  onExport
}) {
  const [note, setNote] = useState(item.reviewNote || '');
  const issuer = entities.find(entity => entity.id === item.documentIssuerId);
  return <Drawer title="Evidence detail" onClose={onClose}>
    <div className="drawer-body"><div className="eyebrow">{item.historical ? 'Historical evidence' : 'Public source evidence'}<Status status={item.status} /></div><h2>{item.title}</h2><p className="detail-summary">{item.summary}</p>
      <div className="attribution-grid"><div><span>Affected company</span><strong>{item.entityName || 'Unresolved — manual review required'}</strong></div><div><span>Report subject / rated entity</span><strong>{issuer?.name || item.documentIssuerId || 'Not stated'}</strong></div></div>
      <div className="note-box"><ShieldCheck size={17} /><p>The report subject is not automatically the affected company. Only explicit subject attribution links evidence to your positions.</p></div>
      <section className="detail-section"><h3>What the source actually says</h3><blockquote>{item.quote || 'No source excerpt available. Do not approve without checking the original document.'}</blockquote><div className="source-meta"><span>{item.sourceTitle || 'Public document'}{item.page ? ` · Page ${item.page}` : ''}</span><SourceLink url={item.sourceUrl} /></div></section>
      <dl className="detail-facts"><div><dt>Event date</dt><dd>{item.eventDate ? eventDateLabel(item) : 'Not stated'}</dd></div><div><dt>Published</dt><dd>{dateLabel(item.publishedAt)}</dd></div><div><dt>First captured</dt><dd>{dateLabel(item.firstSeenAt)}</dd></div><div><dt>Extraction</dt><dd>{pretty(item.extractionMethod || 'Source reviewed')}</dd></div></dl>
      <section className="detail-section"><h3>Exposure context</h3><div className="exposure-highlight"><Money amounts={item.exposure} /><span>Directly linked positions · no FX conversion</span></div><p className="small muted">{item.reason || 'No direct portfolio match. Relationship edges do not create or duplicate exposure.'}</p></section>
      <label className="field-label" htmlFor="review-note">Analyst note <span>Optional</span></label><Textarea id="review-note" value={note} maxLength={2000} onChange={event => setNote(event.target.value)} rows={3} placeholder="Record the attribution check or reason for this decision…" />
      <p className="privacy-caption"><LockKeyhole size={12} />{mode === 'demo' ? 'Demo decisions are local to this tab and reset on reload.' : 'Decision and note are saved in your private cloud workspace. Position amounts are never sent.'}</p>
    </div><div className="drawer-actions"><Button className="button secondary" onClick={() => onExport(item)} variant="outline"><ArrowDownToLine size={16} />Brief</Button><Button className="button secondary" disabled={busy} onClick={() => onDecision(item.id, 'dismissed', note)} variant="outline">Dismiss</Button><Button className="button primary" disabled={busy || !item.entityId || !item.quote} onClick={() => onDecision(item.id, item.status === 'approved' ? 'candidate' : 'approved', note)} variant="default">{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={16} />}{item.status === 'approved' ? 'Reopen review' : 'Approve evidence'}</Button></div>
  </Drawer>;
}
function EntityDetail({
  entity,
  data,
  positions,
  queue,
  onClose,
  onEvent
}) {
  const edges = data.relationships.filter(edge => edge.sourceId === entity.id || edge.targetId === entity.id);
  const evidence = queue.filter(event => event.entityId === entity.id);
  return <Drawer title="Company profile" onClose={onClose}><div className="drawer-body"><div className="large-company-icon"><Building2 size={27} /></div><h2>{entity.name}</h2><Badge className="badge gray" variant="outline">{pretty(entity.role || 'Company')}</Badge><section className="detail-section"><h3>Direct exposure</h3><div className="exposure-highlight"><Money amounts={aggregateExposure(positions, [entity.id])} /><span>Local positions only. Relationships do not add exposure.</span></div></section><section className="detail-section"><h3>Known aliases</h3><p className="small muted">{entity.aliases?.join(' · ') || 'No additional legal-name aliases.'}</p></section><section className="detail-section"><h3>Evidence where this company is the subject</h3>{evidence.length ? evidence.map(event => <Button variant="ghost" className="related-event" key={event.id} onClick={() => onEvent(event.id)}><span>{event.title}<small>{eventDateLabel(event)} · {statusLabel[event.status]}</small></span><ArrowUpRight size={16} /></Button>) : <p className="small muted">No subject-attributed events. Being named in a relationship is not evidence of distress.</p>}</section><section className="detail-section"><h3>Documented relationships</h3>{edges.length ? edges.map(edge => <div className="relationship-card" key={edge.id}><strong>{data.entities.find(item => item.id === (edge.sourceId === entity.id ? edge.targetId : edge.sourceId))?.name}</strong><span>{pretty(edge.type)}{edge.asOf ? ` · ${dateLabel(edge.asOf)}` : ''}</span>{edge.quote && <blockquote>{edge.quote}</blockquote>}<SourceLink url={edge.sourceUrl} /></div>) : <p className="small muted">No documented relationships available.</p>}</section></div></Drawer>;
}
function ExposureBook({
  positions,
  setPositions,
  data,
  search,
  origin,
  setOrigin,
  notify
}) {
  const fileInput = useRef(null);
  const [issues, setIssues] = useState([]);
  const [reading, setReading] = useState(false);
  const [currency, setCurrency] = useState('all');
  const totals = aggregateExposure(positions);
  const visible = positions.filter(position => (currency === 'all' || position.currency === currency) && `${position.positionId} ${data.entities.find(entity => entity.id === position.entityId)?.name || position.entityId}`.toLowerCase().includes(search.toLowerCase()));
  async function importFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setReading(true);
    setIssues([]);
    try {
      if (file.size > 1000000) throw new Error('Use a CSV under 1 MB. No file was imported.');
      const result = parseExposureCSV(await file.text(), data.entities);
      if (result.errors.length) {
        setIssues(result.errors);
        notify('Import rejected. Fix the listed errors; your existing book is unchanged.', 'error');
        return;
      }
      const merged = mergeExposureImport(positions, result, origin === 'Synthetic sample');
      setPositions(merged.positions);
      setOrigin('Imported · local only');
      notify(`Imported ${merged.added} new positions. ${merged.duplicates} duplicate rows skipped. ${origin === 'Synthetic sample' ? 'Synthetic positions replaced. ' : ''}Nothing was uploaded.`);
    } catch (error) {
      setIssues([error.message]);
      notify(error.message, 'error');
    } finally {
      setReading(false);
      event.target.value = '';
    }
  }
  return <>
    <div className="privacy-strip"><LockKeyhole size={18} /><div><strong>Your exposure book never leaves this tab.</strong><span>CSV rows, position IDs and amounts are not sent to Appwrite, TinyFish, or an AI provider. Reloading clears imports.</span></div><Badge className="badge green" variant="outline">Local computation</Badge></div>
    <Card className="panel exposure-import"><div className="upload-symbol"><Upload size={26} /></div><div><h2>Bring your exposure into focus</h2><p>Import a CSV to match positions against known legal entities. The first import replaces the synthetic sample; later imports merge by position ID.</p><code>position_id, entity_id, currency, amount, as_of</code><p className="small muted">INR, USD, EUR or GBP · up to 2 decimal places · positive or zero amounts · YYYY-MM-DD dates</p></div><div className="import-actions"><input ref={fileInput} type="file" accept=".csv,text/csv" onChange={importFile} className="sr-only" aria-label="Upload exposure CSV" /><Button className="button primary" disabled={reading} onClick={() => fileInput.current.click()} variant="default">{reading ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />}Import CSV</Button><Button variant="ghost" className="text-button" onClick={() => download('creditgraph-sample-exposure.csv', SAMPLE_CSV, 'text/csv')}><ArrowDownToLine size={14} />Sample CSV</Button></div></Card>
    {issues.length > 0 && <div className="import-errors" role="alert"><strong>Import not applied</strong><ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
    <div className="currency-cards">{Object.entries(totals).map(([unit, total]) => <div className="panel currency-card" key={unit}><span>{unit} exposure</span><strong>{formatMoney(total, unit)}</strong><small>Exact nominal amount · no FX conversion</small></div>)}{!positions.length && <div className="panel currency-card"><span>Exposure book</span><strong>No positions yet</strong><small>Import your own CSV or load the synthetic sample.</small></div>}</div>
    <Card className="panel"><div className="panel-heading"><div><h2>Position ledger <span className="count-pill">{visible.length}</span></h2><p>{origin} · no graph double counting</p></div><div className="row-actions"><label className="sr-only" htmlFor="currency-filter">Filter currency</label><NativeSelect id="currency-filter" value={currency} onChange={event => setCurrency(event.target.value)}><option value="all">All currencies</option>{['INR', 'USD', 'EUR', 'GBP'].map(unit => <option key={unit}>{unit}</option>)}</NativeSelect><Button variant="ghost" className="text-button" onClick={() => {
            const result = parseExposureCSV(SAMPLE_CSV, data.entities);
            if (result.errors.length) {
              notify(result.errors.join(' '), 'error');
              return;
            }
            setPositions(result.positions);
            setOrigin('Synthetic sample');
            setIssues([]);
            notify('Synthetic sample loaded locally. Your previous in-tab book was replaced.');
          }}>Load sample</Button><Button variant="ghost" className="text-button danger" disabled={!positions.length} onClick={() => {
            setPositions([]);
            setOrigin('Empty book');
            notify('Exposure book cleared from this tab.');
          }}>Clear book</Button></div></div>
      {visible.length ? <div className="table-scroll"><Table className="positions-table"><TableHeader><TableRow><TableHead>Position ID</TableHead><TableHead>Legal entity</TableHead><TableHead>Currency</TableHead><TableHead>Nominal exposure</TableHead><TableHead>As of</TableHead></TableRow></TableHeader><TableBody>{visible.map(position => <TableRow key={position.positionId}><TableCell><code>{position.positionId}</code></TableCell><TableCell><strong>{data.entities.find(entity => entity.id === position.entityId)?.name || position.entityId}</strong><small>{position.entityId}</small></TableCell><TableCell><Badge className="badge gray" variant="outline">{position.currency}</Badge></TableCell><TableCell className="numeric">{formatMoney(position.amountMinor, position.currency)}</TableCell><TableCell>{dateLabel(position.asOf)}</TableCell></TableRow>)}</TableBody></Table></div> : <Empty title={positions.length ? 'No positions match' : 'Your book is empty'}>Import a CSV or load the synthetic sample to add exposure context.</Empty>}
    </Card><p className="page-footnote"><ShieldCheck size={14} />Exposure is a recorded position amount, not expected loss. Values in different currencies are never added together.</p>
  </>;
}
function Sources({
  data,
  mode,
  health,
  busy,
  connect,
  refreshHealth,
  extract,
  collect,
  refreshRun,
  onEvent
}) {
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [publishedAt, setPublishedAt] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourcePage, setSourcePage] = useState('');
  const [issuerId, setIssuerId] = useState('');
  const [collectUrl, setCollectUrl] = useState('');
  const [companyName, setCompanyName] = useState('');
  const sources = [...new Map(data.events.map(event => [event.sourceUrl || event.id, event])).values()];
  return <>
    <div className="source-status-grid"><div className="panel integration-card"><div className="integration-icon"><FileSearch size={21} /></div><div><h3>Evidence extraction</h3><p>{health?.aiConfigured ? 'AI configured · evidence validation required' : 'Rule-based extraction · no AI key configured'}</p></div><Badge className="badge green" variant="outline">{health?.aiConfigured ? 'Configured' : 'Rules available'}</Badge></div><div className="panel integration-card"><div className="integration-icon amber"><Globe2 size={21} /></div><div><h3>TinyFish collection</h3><p>{health ? health.tinyfishConfigured ? 'Server-side public document collection' : 'Add the TinyFish key on the server to enable' : 'Connect or check status to verify configuration'}</p></div><Badge className={`badge ${health?.tinyfishConfigured ? 'green' : 'gray'}`} variant="outline">{health ? health.tinyfishConfigured ? 'Configured' : 'Not configured' : 'Not checked'}</Badge></div></div>
    <div className="source-workbench"><Card className="panel"><div className="panel-heading"><div><span className="eyebrow">01 / Public evidence</span><h2>Extract from a document</h2><p>Paste only public text. Exact source quotes are retained.</p></div><FileText size={22} className="muted" /></div><form className="source-form" onSubmit={event => {
          event.preventDefault();
          extract({
            text,
            sourceUrl: url,
            publishedAt,
            issuerId,
            sourceTitle,
            ...(sourcePage ? {
              page: Number(sourcePage)
            } : {})
          });
        }}><label className="field-label" htmlFor="source-url">Original source URL</label><Input id="source-url" type="url" required placeholder="https://public-source.example/report.pdf" value={url} onChange={event => setUrl(event.target.value)} /><div className="form-two"><div><label className="field-label" htmlFor="source-title">Publisher / document title</label><Input id="source-title" maxLength={300} value={sourceTitle} onChange={event => setSourceTitle(event.target.value)} placeholder="Publisher — original report title" /></div><div><label className="field-label" htmlFor="source-page">Source page <span>Optional</span></label><Input id="source-page" type="number" min={1} max={10000} value={sourcePage} onChange={event => setSourcePage(event.target.value)} placeholder="e.g. 3" /></div></div><div className="form-two"><div><label className="field-label" htmlFor="source-issuer">Report subject / rated entity <span>Not the event subject</span></label><NativeSelect id="source-issuer" value={issuerId} onChange={event => setIssuerId(event.target.value)}><option value="">Not specified</option>{data.entities.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</NativeSelect></div><div><label className="field-label" htmlFor="source-date">Publication date</label><Input id="source-date" type="date" value={publishedAt} onChange={event => setPublishedAt(event.target.value)} /></div></div><label className="field-label" htmlFor="source-text">Public source text <span>{text.length.toLocaleString()} / 30,000</span></label><Textarea id="source-text" value={text} onChange={event => setText(event.target.value)} maxLength={30000} required rows={8} placeholder="Paste the public disclosure or source excerpt here. The affected company must be explicitly named in the evidence sentence." /><p className="small muted">Candidates require analyst review. A company is never treated as distressed merely because it issued or appears in a document.</p><div className="form-bottom"><span><LockKeyhole size={14} />Public text only. Never paste your portfolio.</span>{mode === 'cloud' ? <Button className="button primary" disabled={Boolean(busy)} type="submit" variant="default">{busy === 'extract' ? <LoaderCircle size={15} className="spin" /> : <FileSearch size={16} />}Extract candidates</Button> : <Button type="button" className="button primary" disabled={Boolean(busy)} onClick={connect} variant="default">Connect to extract <ArrowRight size={15} /></Button>}</div></form></Card>
    <Card className="panel collection-panel"><div className="panel-heading"><div><span className="eyebrow">02 / Collection</span><h2>Fetch a public source</h2><p>Server-side collection with TinyFish.</p></div><Globe2 size={22} className="muted" /></div><form className="source-form" onSubmit={event => {
          event.preventDefault();
          collect({
            url: collectUrl,
            companyName
          });
        }}><label className="field-label" htmlFor="collection-url">Public document URL</label><Input id="collection-url" type="url" required value={collectUrl} onChange={event => setCollectUrl(event.target.value)} placeholder="https://allowed-publisher.example/document" /><label className="field-label" htmlFor="collection-company">Company to look for</label><Input id="collection-company" required maxLength={160} value={companyName} onChange={event => setCompanyName(event.target.value)} placeholder="Exact legal company name" /><div className="note-box"><CircleHelp size={18} /><p>Allowed publishers: CareEdge, ICRA, BSE, NSE, BIS and IREDA. Keys stay on the server; no credentials are requested here.</p></div>{mode === 'cloud' ? <Button className="button primary full-width" type="submit" disabled={Boolean(busy) || health?.tinyfishConfigured === false} variant="default">{busy === 'collect' ? <LoaderCircle className="spin" size={15} /> : <Globe2 size={16} />}{health?.tinyfishConfigured === false ? 'TinyFish key not configured' : 'Start collection'}</Button> : <Button className="button secondary full-width" type="button" disabled={Boolean(busy)} onClick={connect} variant="outline">Connect private workspace</Button>}<Button variant="ghost" className="text-button" type="button" disabled={Boolean(busy)} onClick={refreshHealth}><RefreshCw size={13} />Check integration status</Button></form><div className="collection-runs"><h3>Collection runs</h3>{data.runs.length ? data.runs.map(run => <div className="run-row" key={run.id || run.runId}><div><strong>{run.companyName || 'Public source collection'}</strong><small>{pretty(run.status || 'submitted')}</small>{run.error && <small className="danger">{run.error}</small>}{run.results?.text && <Button variant="ghost" className="text-button" type="button" onClick={() => {
                setText(run.results.text);
                setUrl(run.results.sourceUrl || run.url);
                setSourceTitle(run.results.sourceTitle || '');
                setPublishedAt((run.results.publishedAt || '').slice(0, 10));
                setSourcePage('');
                setIssuerId('');
                document.getElementById('source-text')?.focus();
              }}>Use collected text <ArrowRight size={12} /></Button>}</div><Button variant="ghost" className="icon-button" disabled={Boolean(busy) || mode !== 'cloud'} aria-label={`Refresh collection ${run.companyName || run.id}`} onClick={() => refreshRun(run.id || run.runId)}><RefreshCw size={15} /></Button></div>) : <p className="small muted">No collection runs yet. Nothing is fetched automatically.</p>}</div></Card></div>
    <Card className="panel"><div className="panel-heading"><div><h2>Source library <span className="count-pill">{sources.length}</span></h2><p>Original publications behind the current evidence set.</p></div><BookOpen size={21} className="muted" /></div><div className="source-library">{sources.map(source => <div className="source-library-row" key={source.sourceUrl || source.id}><div className="document-icon"><FileText size={21} /></div><div><h3>{source.sourceTitle || source.title}</h3><p>{data.entities.find(entity => entity.id === source.documentIssuerId)?.name ? `Report subject: ${data.entities.find(entity => entity.id === source.documentIssuerId).name}` : 'Report subject not stated'} · {dateLabel(source.publishedAt)}{source.historical ? ' · Historical publication' : ''}</p><SourceLink url={source.sourceUrl} /></div><Button className="button secondary small-button" onClick={() => onEvent(source.id)} variant="outline">View evidence <ArrowUpRight size={13} /></Button></div>)}{!sources.length && <Empty title="No sources yet">Extract a public document to add source-linked evidence.</Empty>}</div></Card>
  </>;
}
export default function App() {
  const [page, setPage] = useState('overview');
  const [mode, setMode] = useState('demo');
  const [demo, setDemo] = useState(() => hydrateWorkspace(sampleData));
  const [cloud, setCloud] = useState(() => hydrateWorkspace({}));
  const [positions, setPositions] = useState(() => parseExposureCSV(SAMPLE_CSV, sampleData.entities).positions);
  const [origin, setOrigin] = useState('Synthetic sample');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [entityId, setEntityId] = useState(null);
  const [busy, setBusy] = useState('');
  const [health, setHealth] = useState(null);
  const [notice, setNotice] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const client = useRef(null);
  if (!client.current) client.current = createCloudClient();
  const data = mode === 'demo' ? demo : cloud;
  const queue = useMemo(() => buildReviewQueue(data.events, positions, data.entities), [data.events, positions, data.entities]);
  const allItems = useMemo(() => data.events.map(event => queue.find(item => item.id === event.id) || {
    ...event,
    entityName: data.entities.find(entity => entity.id === event.entityId)?.name || 'Unresolved subject',
    exposure: aggregateExposure(positions, event.entityId ? [event.entityId] : []),
    priority: 'low'
  }), [data.events, data.entities, queue, positions]);
  const ordered = [...allItems].sort((a, b) => ({
    high: 0,
    medium: 1,
    low: 2
  })[a.priority] - {
    high: 0,
    medium: 1,
    low: 2
  }[b.priority]);
  const matching = ordered.filter(item => `${item.entityName} ${item.title} ${item.type} ${item.quote}`.toLowerCase().includes(search.toLowerCase()));
  const visible = matching.filter(item => filter === 'all' || (filter === 'high' ? item.priority === 'high' : item.status === filter));
  const pending = data.events.filter(event => event.status === 'candidate').length;
  const approved = data.events.filter(event => event.status === 'approved').length;
  const high = queue.filter(item => item.priority === 'high');
  const totals = aggregateExposure(positions);
  const activeItem = selected ? allItems.find(item => item.id === selected) : null;
  const activeEntity = entityId ? data.entities.find(entity => entity.id === entityId) : null;
  const subjectIds = new Set(data.events.filter(event => event.status !== 'dismissed' && event.entityId).map(event => event.entityId));
  const exposedEntityIds = [...new Set(positions.map(position => position.entityId))];
  const sourceCount = new Set(data.events.map(event => event.sourceUrl).filter(Boolean)).size;
  const notify = (message, type = 'success') => setNotice({
    message,
    type
  });
  const changePage = next => {
    setPage(next);
    setSearch('');
    setFilter('all');
    setMobileOpen(false);
    setSelected(null);
    setEntityId(null);
  };
  const chooseEvent = id => {
    setEntityId(null);
    setSelected(id);
  };
  const chooseEntity = id => {
    setSelected(null);
    setEntityId(id);
  };
  const saveBrief = item => {
    download(`creditgraph-brief-${item.id}.txt`, exportBrief(item));
    notify('Evidence brief downloaded. It contains local exposure amounts; share deliberately.');
  };
  async function connect() {
    setBusy('connect');
    setNotice(null);
    try {
      await client.current.connect();
      const [workspace, service] = await Promise.all([client.current.call('bootstrap'), client.current.call('health')]);
      setCloud(hydrateWorkspace(workspace));
      setHealth(service);
      setMode('cloud');
      setSelected(null);
      setEntityId(null);
      notify('Private workspace connected. Your exposure book remains local. Anonymous access is tied to this browser session.');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function refreshHealth() {
    setBusy('health');
    try {
      const result = await client.current.call('health');
      setHealth(result);
      notify('Integration status checked against the cloud service.');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function refreshCloud() {
    setBusy('refresh');
    try {
      setCloud(hydrateWorkspace(await client.current.call('bootstrap')));
      notify('Private workspace refreshed. Local positions were not sent.');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function decide(eventId, status, note) {
    setBusy('review');
    try {
      if (mode === 'demo') {
        setDemo(previous => ({
          ...previous,
          events: previous.events.map(event => event.id === eventId ? {
            ...event,
            status,
            reviewNote: note
          } : event)
        }));
        notify(`${statusLabel[status]} — demo decision saved in this tab only.`);
      } else {
        await client.current.call('review', {
          eventId,
          status,
          note
        });
        const next = hydrateWorkspace(await client.current.call('bootstrap'));
        if (next.events.find(event => event.id === eventId)?.status !== status) throw new Error('The decision was sent but could not be verified. Refresh before retrying.');
        setCloud(next);
        notify('Decision saved and verified in your private workspace.');
      }
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function extract(payload) {
    setBusy('extract');
    try {
      const result = await client.current.call('extract', payload);
      const next = hydrateWorkspace(await client.current.call('bootstrap'));
      setCloud(next);
      const newCount = next.events.filter(event => !cloud.events.some(existing => existing.id === event.id)).length;
      notify(`${newCount} new candidates verified in your workspace. ${/rule|deterministic/i.test(result.mode || '') ? 'Rule-based extraction, not AI.' : 'Check source attribution before approval.'}`);
      if (newCount) {
        setPage('review');
        setFilter('candidate');
      }
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function collect(payload) {
    setBusy('collect');
    try {
      const result = await client.current.call('collect', payload);
      await client.current.call('runStatus', {
        runId: result.runId
      });
      setCloud(hydrateWorkspace(await client.current.call('bootstrap')));
      notify('Collection run created and its status checked. Refresh the run to retrieve progress.');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function refreshRun(runId) {
    setBusy('run');
    try {
      const result = await client.current.call('runStatus', {
        runId
      });
      setCloud(hydrateWorkspace(await client.current.call('bootstrap')));
      notify(`Collection status: ${pretty(result.status || result.run?.status || 'checked')}.`);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy('');
    }
  }
  return <DashboardLayout navigation={navigation} page={page} onPage={changePage} pending={pending} mode={mode} busy={busy} connect={connect} backToDemo={() => {setMode('demo');setSelected(null);setEntityId(null);notify('Historical demo reopened. Your cloud session remains available.');}}>
        <div className="page-heading"><div><h2>{navigation.find(item => item.id === page).title}</h2><p>{pageCopy[page][1]}</p></div><div className="heading-action">{page === 'overview' || page === 'exposure' ? <Button onClick={() => {changePage('exposure');setTimeout(() => document.querySelector('input[type=file]')?.click(), 0);}}><Upload size={16} />Import CSV</Button> : mode === 'cloud' ? <Button variant="outline" disabled={Boolean(busy)} onClick={refreshCloud}><RefreshCw className={busy === 'refresh' ? 'spin' : ''} size={15} />Refresh</Button> : null}</div></div>
        <div className="workspace-toolbar"><div className="replay-banner"><History size={14} /><span>{mode === 'demo' ? 'Historical evidence · Synthetic positions · Not live' : 'Private workspace · Original publication dates retained'}</span></div>
        {['overview', 'review', 'exposure', 'graph'].includes(page) && <div className="global-search"><Search size={17} /><Input aria-label="Search companies and evidence" value={search} onChange={event => setSearch(event.target.value)} placeholder={page === 'exposure' ? 'Company or position ID' : 'Search companies / evidence'} />{search ? <Button variant="ghost" className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></Button> : <span className="search-hint">Search this view</span>}</div>}
        </div>
        {notice && <div className={`notice ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}><span>{notice.type === 'error' ? <CircleHelp size={18} /> : <CheckCheck size={18} />}{notice.message}</span><Button variant="ghost" className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={16} /></Button></div>}
        {page === 'overview' && <Overview {...{exposedEntityIds,positions,pending,high,sourceCount,totals,origin,subjectIds,data,chooseEntity,changePage,matching,chooseEvent,EventTable}} />}
        {page === 'exposure' && <ExposureBook positions={positions} setPositions={setPositions} data={data} search={search} origin={origin} setOrigin={setOrigin} notify={notify} />}
        {page === 'review' && <><div className="review-summary"><div><span className="summary-number">{pending}</span><span>Awaiting attribution review</span></div><div><span className="summary-number">{approved}</span><span>Evidence approved</span></div><div><span className="summary-number">{high.length}</span><span>High-priority review items</span></div><p><ShieldCheck size={17} />Approve a claim only after checking its subject and original evidence.</p></div><Card className="panel"><div className="filter-toolbar"><Tabs value={filter} onValueChange={setFilter}><TabsList className="filter-tabs" aria-label="Filter evidence">{[['all','All evidence'],['candidate','Needs review'],['approved','Reviewed'],['dismissed','Dismissed'],['high','High priority']].map(([value,label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}</TabsList></Tabs><span className="small muted"><Filter size={13} />{visible.length} items</span></div><EventTable items={visible} onSelect={chooseEvent} /></Card><p className="page-footnote">{mode === 'demo' ? 'Demo approvals and dismissals only change this tab. Reload to restore the original replay.' : 'Decisions are private to the connected analyst session. Amounts remain local.'}</p></>}
        {page === 'graph' && <><div className="graph-page-grid"><Card className="panel full-graph"><div className="panel-heading"><div><h2>Documented company network</h2><p>{data.entities.length} entities · {data.relationships.length} source-linked relationships</p></div><Badge className="badge gray" variant="outline">Evidence, not contagion</Badge></div><Graph entities={search ? data.entities.filter(entity => `${entity.name} ${entity.aliases?.join(' ')}`.toLowerCase().includes(search.toLowerCase())) : data.entities} relationships={data.relationships} events={data.events} onSelect={chooseEntity} /></Card><aside className="graph-context"><div className="panel"><span className="eyebrow">HOW TO READ THE GRAPH</span><h2>Connections aren't conclusions.</h2><p>Each edge represents a documented relationship, not a prediction of financial distress.</p><ul><li><span>01</span>Click a company to inspect its direct exposure.</li><li><span>02</span>Check the original source behind each relationship.</li><li><span>03</span>Review events attributed to the actual affected company.</li></ul><div className="note-box"><ShieldCheck size={17} /><p>Exposure is counted once per position. It never flows automatically across an edge.</p></div></div><Button className="button primary full-width" onClick={() => changePage('review')} variant="default">Review the evidence <ArrowRight size={15} /></Button></aside></div></>}
        {page === 'sources' && <Sources data={data} mode={mode} health={health} busy={busy} connect={connect} refreshHealth={refreshHealth} extract={extract} collect={collect} refreshRun={refreshRun} onEvent={chooseEvent} />}
        <footer className="workspace-footer"><span>CreditGraph <i />Source-first credit intelligence</span><span><ShieldCheck size={12} />Not financial advice · No predicted loss</span></footer>

    {activeItem && <EventDetail key={activeItem.id} item={activeItem} entities={data.entities} mode={mode} busy={busy === 'review'} onDecision={decide} onClose={() => setSelected(null)} onExport={saveBrief} />}
    {activeEntity && <EntityDetail entity={activeEntity} data={data} positions={positions} queue={allItems} onClose={() => setEntityId(null)} onEvent={chooseEvent} />}
  </DashboardLayout>;
}
