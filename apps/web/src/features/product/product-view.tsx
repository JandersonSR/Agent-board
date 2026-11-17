// Product view: the initiative split into stages (with pairs, dependencies and risks).
// Progress comes from the issues tracked in PRs and deploys; the critical path shows what holds the delivery.
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CalendarClock, ChevronDown, ChevronRight, Flag, Link2, Loader2, Pencil, Plus, Route, Trash2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState, Pill, type Tone } from '@/components/common';
import {
  useDeleteInitiative, useInitiatives, useSaveInitiative,
  type Initiative, type InitiativeInput, type InitiativeStatus, type RiskLevel, type Stage, type StageStatus, type StageView,
} from '@/hooks/use-staff';
import { fmtDay } from '@/lib/format';
import { k, t } from '@/lib/i18n';
import { usePref } from '@/lib/prefs';
import { cn } from '@/lib/utils';
import { Tile } from '../metrics/shared';

const STAGE: Record<StageStatus, { label: string; tone: Tone }> = {
  not_started: { label: k('not started'), tone: 'neutral' }, in_progress: { label: k('in progress'), tone: 'info' },
  blocked: { label: k('blocked'), tone: 'danger' }, done: { label: k('done'), tone: 'success' },
};
const INIT: Record<InitiativeStatus, string> = { planned: k('planned'), active: k('active'), paused: k('paused'), done: k('done') };
const RISK: Record<RiskLevel, { label: string; tone: Tone }> = {
  high: { label: k('high'), tone: 'danger' }, medium: { label: k('medium'), tone: 'warning' }, low: { label: k('low'), tone: 'neutral' },
};
const pctText = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
/** Short, fixed stage id (dependencies point to it; renaming the stage does not change the id). */
const newStageId = () => `s-${Math.random().toString(36).slice(2, 8)}`;

/** Depth of each stage in the dependency graph (the board columns). */
function depths(stages: Stage[]): Map<string, number> {
  const byId = new Map(stages.map(s => [s.id, s]));
  const memo = new Map<string, number>();
  const depth = (id: string, seen: Set<string>): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const deps = byId.get(id)?.dependsOn.filter(d => byId.has(d)) ?? [];
    const v = deps.length ? 1 + Math.max(...deps.map(d => depth(d, seen))) : 0;
    memo.set(id, v);
    return v;
  };
  for (const s of stages) depth(s.id, new Set());
  return memo;
}

function StageCard({ s, names }: { s: StageView; names: Map<string, string> }) {
  const [open, setOpen] = useState(false);
  const status = s.status === 'in_progress' && s.waitingOn.length ? { label: k('waiting on dependency'), tone: 'warning' as Tone } : STAGE[s.status];
  return (
    <article className={cn('space-y-2 rounded-xl border bg-card p-3 shadow-xs', s.critical && 'ring-2 ring-warning/60', s.status === 'done' && 'opacity-75')}>
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">{s.critical && <Route className="size-3.5 shrink-0 text-warning" aria-label={t('critical path')} />}<span className="truncate">{s.name}</span></h3>
          {s.owners.length > 0 && <p className="truncate text-[11px] text-muted-foreground">{s.owners.join(' · ')}</p>}
        </div>
        <Pill tone={status.tone}>{t(status.label)}</Pill>
      </header>
      <div className="space-y-1">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-success" style={{ width: `${s.matched.length ? (s.deployed / s.matched.length) * 100 : s.status === 'done' ? 100 : 0}%` }} />
          <div className="h-full bg-series-1" style={{ width: `${s.matched.length ? ((s.merged - s.deployed) / s.matched.length) * 100 : 0}%` }} />
        </div>
        <p className="flex justify-between text-[11px] text-muted-foreground">
          <span>{s.matched.length ? t('{m}/{n} merged · {d} in production', { m: s.merged, n: s.matched.length, d: s.deployed }) : t('no linked issues')}</span>
          <span className="tabular-nums">{pctText(s.progress)}</span>
        </p>
      </div>
      {(s.waitingOn.length > 0 || s.late || s.targetDate) && (
        <div className="flex flex-wrap gap-1 text-[11px]">
          {s.waitingOn.map(d => <Pill key={d} tone="warning"><Link2 className="size-3" />{names.get(d) ?? d}</Pill>)}
          {s.targetDate && <Pill tone={s.late ? 'danger' : 'neutral'}><CalendarClock className="size-3" />{fmtDay(s.targetDate)}</Pill>}
        </div>
      )}
      {s.risks.length > 0 && (
        <ul className="space-y-0.5 text-[11px]">
          {s.risks.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5"><Pill tone={RISK[r.level].tone} className="shrink-0">{t(RISK[r.level].label)}</Pill><span>{r.text}{r.mitigation && <span className="text-muted-foreground"> → {r.mitigation}</span>}</span></li>
          ))}
        </ul>
      )}
      {s.matched.length > 0 && (
        <div>
          <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} {t('{n} issue(s)', { n: s.matched.length })}
          </button>
          {open && (
            <ul className="mt-1 space-y-0.5 text-[11px]">
              {s.matched.map(m => (
                <li key={m.key} className="flex items-center gap-1.5">
                  <span className={cn('size-1.5 shrink-0 rounded-full', m.deployed ? 'bg-success' : m.status === 'merged' ? 'bg-series-1' : 'bg-muted-foreground/40')} />
                  <a href={m.key.startsWith('http') ? m.key : undefined} target="_blank" rel="noreferrer" className="truncate hover:underline">{m.title}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {s.notes && <p className="text-[11px] text-muted-foreground">{s.notes}</p>}
    </article>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={cn('space-y-1', className)}><Label className="text-[11px] text-muted-foreground">{t(label)}</Label>{children}</div>;
}

function StageEditor({ s, all, onChange, onRemove, onMove }: {
  s: Stage; all: Stage[]; onChange: (p: Partial<Stage>) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void;
}) {
  const others = all.filter(o => o.id !== s.id);
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Input value={s.name} onChange={e => onChange({ name: e.target.value })} placeholder={t('Stage name')} className="h-8 flex-1 text-sm font-medium" maxLength={120} />
        <Select value={s.status} onValueChange={v => onChange({ status: v as StageStatus })}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{(Object.keys(STAGE) as StageStatus[]).map(x => <SelectItem key={x} value={x}>{t(STAGE[x].label)}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="icon-xs" variant="ghost" onClick={() => onMove(-1)} aria-label={t('Move up')}><ArrowUp /></Button>
        <Button size="icon-xs" variant="ghost" onClick={() => onMove(1)} aria-label={t('Move down')}><ArrowDown /></Button>
        <Button size="icon-xs" variant="ghost" className="text-danger" onClick={onRemove} aria-label={t('Remove')}><Trash2 /></Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label={k('Pair/owners (comma)')}><Input value={s.owners.join(', ')} onChange={e => onChange({ owners: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} className="h-8 text-xs" /></Field>
        <Field label={k('Target date')}><Input type="date" value={s.targetDate ?? ''} onChange={e => onChange({ targetDate: e.target.value || undefined })} className="h-8 text-xs" /></Field>
        <Field label={k('Text in issue titles')}><Input value={s.query ?? ''} onChange={e => onChange({ query: e.target.value || undefined })} placeholder="[simulation]" className="h-8 text-xs" /></Field>
      </div>
      {others.length > 0 && (
        <Field label={k('Depends on')}>
          <div className="flex flex-wrap gap-1">
            {others.map(o => {
              const on = s.dependsOn.includes(o.id);
              return (
                <button key={o.id} type="button" onClick={() => onChange({ dependsOn: on ? s.dependsOn.filter(d => d !== o.id) : [...s.dependsOn, o.id] })}
                  className={cn('rounded-md border px-2 py-0.5 text-[11px]', on ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}>
                  {o.name || o.id}
                </button>
              );
            })}
          </div>
        </Field>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={k('Issues (URL or repo#123, one per line)')}>
          <Textarea value={s.issues.join('\n')} onChange={e => onChange({ issues: e.target.value.split('\n').map(x => x.trim()).filter(Boolean) })} rows={3} className="font-mono text-[11px]" />
        </Field>
        <Field label={k('Notes')}><Textarea value={s.notes ?? ''} onChange={e => onChange({ notes: e.target.value || undefined })} rows={3} className="text-xs" maxLength={2000} /></Field>
      </div>
      <Field label={k('Risks')}>
        <div className="space-y-1">
          {s.risks.map((r, i) => {
            const set = (p: Partial<Stage['risks'][number]>) => onChange({ risks: s.risks.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              <div key={i} className="flex items-center gap-1.5">
                <Select value={r.level} onValueChange={v => set({ level: v as RiskLevel })}>
                  <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(RISK) as RiskLevel[]).map(x => <SelectItem key={x} value={x}>{t(RISK[x].label)}</SelectItem>)}</SelectContent>
                </Select>
                <Input value={r.text} onChange={e => set({ text: e.target.value })} placeholder={t('Risk')} className="h-7 flex-1 text-xs" maxLength={500} />
                <Input value={r.mitigation ?? ''} onChange={e => set({ mitigation: e.target.value || undefined })} placeholder={t('Mitigated')} className="h-7 flex-1 text-xs" maxLength={500} />
                <Button size="icon-xs" variant="ghost" onClick={() => onChange({ risks: s.risks.filter((_, j) => j !== i) })} aria-label={t('Remove')}><X /></Button>
              </div>
            );
          })}
          <Button size="xs" variant="outline" onClick={() => onChange({ risks: [...s.risks, { text: '', level: 'medium' }] })}><Plus /> {t('Risk')}</Button>
        </div>
      </Field>
    </div>
  );
}

function InitiativeDialog({ initiative, open, onOpenChange, onSaved }: { initiative: Initiative | null; open: boolean; onOpenChange: (o: boolean) => void; onSaved: (id?: string) => void }) {
  const save = useSaveInitiative();
  const del = useDeleteInitiative();
  const [d, setD] = useState<Required<Pick<InitiativeInput, 'name' | 'status' | 'stages'>> & InitiativeInput>({ name: '', status: 'active', stages: [] });
  useEffect(() => {
    if (!open) return;
    setD(initiative ? { name: initiative.name, goal: initiative.goal, status: initiative.status, targetDate: initiative.targetDate, stages: initiative.stages }
      : { name: '', goal: '', status: 'active', stages: [] });
  }, [open, initiative]);
  const setStage = (i: number, p: Partial<Stage>) => setD(x => ({ ...x, stages: x.stages.map((s, j) => (j === i ? { ...s, ...p } : s)) }));
  const addStage = () => setD(x => {
    const id = newStageId();
    return { ...x, stages: [...x.stages, { id, name: '', owners: [], status: 'not_started', dependsOn: x.stages.length ? [x.stages[x.stages.length - 1]!.id] : [], issues: [], risks: [] }] };
  });
  const move = (i: number, dir: -1 | 1) => setD(x => {
    const j = i + dir;
    if (j < 0 || j >= x.stages.length) return x;
    const st = [...x.stages];
    [st[i], st[j]] = [st[j]!, st[i]!];
    return { ...x, stages: st };
  });
  const remove = (i: number) => setD(x => {
    const id = x.stages[i]!.id;
    return { ...x, stages: x.stages.filter((_, j) => j !== i).map(s => ({ ...s, dependsOn: s.dependsOn.filter(d => d !== id) })) };
  });
  const body = (): InitiativeInput => ({
    name: d.name.trim(), status: d.status, ...(d.goal?.trim() ? { goal: d.goal.trim() } : {}), ...(d.targetDate ? { targetDate: d.targetDate } : {}),
    stages: d.stages.map(s => ({ ...s, name: s.name.trim() || s.id, risks: s.risks.filter(r => r.text.trim()) })),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t(initiative ? 'Edit initiative' : 'New initiative')}</DialogTitle>
          <DialogDescription>{t('Split the product into stages with an owner. Link each stage\'s issues (by URL or by text in the title) so progress comes from GitHub.')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label={k('Name')} className="sm:col-span-2"><Input value={d.name} onChange={e => setD(x => ({ ...x, name: e.target.value }))} maxLength={120} /></Field>
            <Field label={k('Status')}>
              <Select value={d.status} onValueChange={v => setD(x => ({ ...x, status: v as InitiativeStatus }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(INIT) as InitiativeStatus[]).map(x => <SelectItem key={x} value={x}>{t(INIT[x])}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={k('Target date')}><Input type="date" value={d.targetDate ?? ''} onChange={e => setD(x => ({ ...x, targetDate: e.target.value || undefined }))} /></Field>
            <Field label={k('Goal (what changes for the customer or the business)')} className="sm:col-span-4"><Textarea value={d.goal ?? ''} onChange={e => setD(x => ({ ...x, goal: e.target.value }))} rows={2} maxLength={2000} /></Field>
          </div>
          <div className="space-y-2">
            {d.stages.map((s, i) => (
              <StageEditor key={s.id} s={s} all={d.stages} onChange={p => setStage(i, p)}
                onRemove={() => remove(i)} onMove={dir => move(i, dir)} />
            ))}
            <Button size="sm" variant="outline" onClick={addStage}><Plus /> {t('Stage')}</Button>
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          {initiative ? <Button variant="ghost" className="text-danger" onClick={() => del.mutate(initiative._id, { onSuccess: () => { onOpenChange(false); onSaved(); } })}><Trash2 /> {t('Delete')}</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
            <Button disabled={!d.name.trim() || save.isPending} onClick={() => save.mutate({ ...(initiative ? { id: initiative._id } : {}), body: body() }, {
              onSuccess: r => { onOpenChange(false); onSaved((r as { id?: string; _id?: string }).id ?? initiative?._id); },
            })}>{save.isPending && <Loader2 className="animate-spin" />} {t('Save')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProductView() {
  const q = useInitiatives();
  const [selected, setSelected] = usePref<string>('product.selected', '');
  const [editing, setEditing] = useState<Initiative | null | undefined>(undefined);
  const items = q.data?.items ?? [];
  const cur = items.find(i => i._id === selected) ?? items[0];
  const v = cur?.view;
  const names = useMemo(() => new Map(cur?.stages.map(s => [s.id, s.name]) ?? []), [cur]);
  const columns = useMemo(() => {
    if (!v) return [] as StageView[][];
    const dep = depths(v.stages);
    const cols: StageView[][] = [];
    for (const s of v.stages) (cols[dep.get(s.id) ?? 0] ??= []).push(s);
    return cols.filter(Boolean);
  }, [v]);

  if (q.data && !q.data.configured) {
    return <div className="rounded-xl border border-dashed"><EmptyState icon={Flag} title={t('MongoDB not configured')} description={t('Initiatives are stored in the board\'s own MongoDB collection.')} /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {items.length > 0 && (
          <Select value={cur?._id ?? ''} onValueChange={setSelected}>
            <SelectTrigger className="h-9 w-auto min-w-72 max-w-xl"><SelectValue /></SelectTrigger>
            <SelectContent>{items.map(i => <SelectItem key={i._id} value={i._id}>{i.name} · {t(INIT[i.status])}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {cur && <Button size="sm" variant="outline" onClick={() => setEditing(cur)}><Pencil /> {t('Edit')}</Button>}
        <Button size="sm" className="ml-auto" onClick={() => setEditing(null)}><Plus /> {t('New initiative')}</Button>
      </div>

      {q.isLoading && <Skeleton className="h-64" />}
      {q.data && !items.length && (
        <div className="rounded-xl border border-dashed">
          <EmptyState icon={Flag} title={t('No initiatives')} description={t('Add the current product (e.g. the loan flow) with its stages, the pair on each one, dependencies and risks.')}
            action={<Button size="sm" onClick={() => setEditing(null)}><Plus /> {t('New initiative')}</Button>} />
        </div>
      )}

      {cur && v && (
        <>
          {cur.goal && <p className="max-w-3xl text-sm text-muted-foreground">{cur.goal}</p>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label={t('Progress')} value={pctText(v.progress)} sub={t('{d} of {n} stages done', { d: v.doneStages, n: v.stages.length })} />
            <Tile label={t('Target date')} value={cur.targetDate ? fmtDay(cur.targetDate, true) : '—'} sub={t(INIT[cur.status])} />
            <Tile label={t('Blocked or waiting')} value={String(v.blocked)} />
            <Tile label={t('Late stages')} value={String(v.late)} />
            <Tile label={t('Open high risks')} value={String(v.highRisks)} />
          </div>

          {v.criticalPath.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs">
              <Route className="size-4 text-warning" /> <b>{t('Critical path:')}</b>
              {v.criticalPath.map((id, i) => <span key={id} className="flex items-center gap-1.5">{i > 0 && <ArrowRight className="size-3 text-muted-foreground" />}{names.get(id) ?? id}</span>)}
            </p>
          )}

          {v.stages.length === 0 ? (
            <div className="rounded-xl border border-dashed"><EmptyState icon={Flag} title={t('No stages yet')} action={<Button size="sm" variant="outline" onClick={() => setEditing(cur)}><Plus /> {t('Stage')}</Button>} /></div>
          ) : (
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pt-1 pb-2">
              {columns.map((col, i) => (
                <div key={i} className="w-72 shrink-0 space-y-3">{col.map(s => <StageCard key={s.id} s={s} names={names} />)}</div>
              ))}
            </div>
          )}
          {v.stages.some(s => s.status === 'blocked' || s.waitingOn.length) && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><AlertTriangle className="size-3.5" /> {t('Stages in progress that depend on an unfinished stage show as "waiting on dependency".')}</p>
          )}
        </>
      )}
      <InitiativeDialog initiative={editing ?? null} open={editing !== undefined} onOpenChange={o => { if (!o) setEditing(undefined); }} onSaved={id => id && setSelected(id)} />
    </div>
  );
}
