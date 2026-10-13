import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ArrowUpRight, ArrowRight, Wallet, FileSearch, Activity, BookOpen, LockKeyhole } from 'lucide-react';
import { formatMoney } from '@/domain';

// Metric grid follows dashboard-01 SectionCards; values are derived, never invented trends.
export function Overview({ exposedEntityIds, positions, pending, high, sourceCount, totals, origin, subjectIds, data, chooseEntity, changePage, matching, chooseEvent, EventTable }) {
 const metrics = [
  ['Companies',exposedEntityIds.length,`${positions.length} recorded positions`,Wallet],
  ['Needs review',pending,'Candidates awaiting attribution',FileSearch],
  ['High priority',high.length,'Reviewed + directly exposed',Activity],
  ['Public sources',sourceCount,'Original source publications',BookOpen],
 ];
 return <>
  <div className="grid grid-cols-2 gap-3 @4xl/main:grid-cols-4">{metrics.map(([label,value,caption,Icon]) => <Card key={label} className="metric-card gap-2 py-3"><CardHeader className="gap-1 px-4"><CardDescription className="flex items-center justify-between text-sm">{label}<Icon className="size-4" /></CardDescription><CardTitle className="text-2xl font-semibold tabular-nums tracking-tight">{value}</CardTitle></CardHeader><CardFooter className="px-4 text-xs text-muted-foreground">{caption}</CardFooter></Card>)}</div>
  <div className="overview-workgrid grid min-w-0 grid-cols-1 items-start gap-4 @4xl/main:grid-cols-[minmax(0,1fr)_280px]">
   <Card className="panel evidence-panel min-w-0 gap-0 overflow-hidden py-0"><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 p-4"><div><CardTitle className="text-base">Evidence to investigate</CardTitle><CardDescription className="mt-1">Direct exposure and review state · {matching.length} events</CardDescription></div><Button size="sm" variant="outline" onClick={() => changePage('review')}>Review queue<ArrowUpRight /></Button></CardHeader><p className="table-scroll-hint px-4 pb-2 text-xs text-muted-foreground sm:hidden">Swipe table horizontally for exposure and status →</p><EventTable items={matching} onSelect={chooseEvent} compact /><CardFooter className="border-t p-3 text-xs text-muted-foreground">Dated public evidence. Priority is not a default probability.</CardFooter></Card>
   <div className="overview-rail grid min-w-0 gap-4"><Card className="gap-3 py-3"><CardHeader className="px-4"><CardTitle className="text-base">Exposure book</CardTitle><CardDescription>{origin}</CardDescription></CardHeader><CardContent className="space-y-3 px-4">{Object.entries(totals).length ? Object.entries(totals).map(([currency,total]) => <div key={currency} className="flex flex-wrap items-baseline justify-between gap-1"><div className="text-xs text-muted-foreground">{currency}</div><div className="break-words text-base font-medium tabular-nums tracking-tight">{formatMoney(total,currency)}</div></div>) : <p className="text-sm text-muted-foreground">No positions imported.</p>}<div className="border-t pt-3"><div className="mb-2 flex justify-between gap-2 text-xs"><span className="text-muted-foreground">Companies with evidence</span><span>{exposedEntityIds.filter(id => subjectIds.has(id)).length} / {exposedEntityIds.length}</span></div><Progress aria-label="Companies with directly attributed evidence" value={exposedEntityIds.length ? exposedEntityIds.filter(id => subjectIds.has(id)).length / exposedEntityIds.length * 100 : 0} className="h-1.5" /></div><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><LockKeyhole className="size-3" />Exact amounts. No FX conversion.</p></CardContent><CardFooter className="px-4"><Button size="sm" variant="outline" className="w-full" onClick={() => changePage('exposure')}>Manage positions<ArrowRight /></Button></CardFooter></Card>
   <Card className="gap-2 py-3"><CardHeader className="px-4"><CardTitle className="text-base">Company directory</CardTitle><CardDescription>{data.relationships.length} documented relationships</CardDescription></CardHeader><CardContent className="px-2">{data.entities.map(entity => <Button key={entity.id} variant="ghost" className="h-auto w-full justify-between gap-3 whitespace-normal px-2 py-2 text-left text-sm" onClick={() => chooseEntity(entity.id)}><span className="min-w-0">{entity.name}</span><ArrowUpRight className="size-3 shrink-0" /></Button>)}</CardContent><CardFooter className="px-4"><Button size="sm" variant="outline" className="w-full" onClick={() => changePage('graph')}>Open relationship graph<ArrowRight /></Button></CardFooter></Card></div>
  </div>
 </>;
}
