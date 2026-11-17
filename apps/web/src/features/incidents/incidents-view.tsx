// Incidents and postmortems: a log with impact, timeline, cause, and actions with owner and deadline.
// The postmortem comes out as Markdown (blameless) to paste into a doc or the repository.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardCopy, Download, Loader2, Plus, Save, Siren, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState, Pill, type Tone } from '@/components/common';
import {
  SEVERITIES, useDeleteIncident, useIncidents, useSaveIncident,
  type Incident, type IncidentAction, type IncidentStatus, type PostmortemStatus, type Severity,
} from '@/hooks/use-staff';
import { api } from '@/lib/api';
import { ago, dur, fmtDay } from '@/lib/format';
import { getLang, k, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const SEV_TONE: Record<Severity, Tone> = { sev1: 'danger', sev2: 'danger', sev3: 'warning', sev4: 'neutral' };
const STATUS: Record<IncidentStatus, { label: string; tone: Tone }> = {
  open: { label: k('open'), tone: 'danger' }, mitigated: { label: k('mitigated'), tone: 'warning' }, resolved: { label: k('resolved'), tone: 'success' },
};
const PM: Record<PostmortemStatus, string> = { pending: k('pending'), draft: k('draft'), done: k('done|postmortem'), not_needed: k('not needed') };

/** ISO → <input type="datetime-local"> value in the browser's time zone. */
const toLocal = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean);
const newId = () => Math.random().toString(36).slice(2, 10);

type Draft = Omit<Incident, '_id' | 'createdAt' | 'updatedAt'>;
const draftOf = (i: Incident): Draft => ({
  title: i.title, severity: i.severity, status: i.status, startedAt: i.startedAt, detectedAt: i.detectedAt ?? null,
  mitigatedAt: i.mitigatedAt ?? null, resolvedAt: i.resolvedAt ?? null, impact: i.impact ?? '', services: i.services ?? [],
  causeChanges: i.causeChanges ?? [], fixChanges: i.fixChanges ?? [], timeline: i.timeline ?? [], actions: i.actions ?? [],
  postmortem: i.postmortem ?? { status: 'pending' },
});

/** Removes empty fields the server would refuse (empty URL, optional empty text). */
function cleanDraft(d: Draft): Draft {
  const pm = { ...d.postmortem };
  for (const key of ['url', 'whatHappened', 'rootCause', 'wentWell', 'wentWrong', 'lessons'] as const) if (!pm[key]?.trim()) delete pm[key];
  return {
    ...d, timeline: d.timeline.filter(e => e.text.trim()),
    actions: d.actions.filter(a => a.text.trim()).map(a => ({ ...a, ...(a.owner?.trim() ? {} : { owner: undefined }), ...(a.due ? {} : { due: undefined }) })),
    postmortem: pm,
  };
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={cn('space-y-1', className)}><Label className="text-xs text-muted-foreground">{t(label)}</Label>{children}</div>;
}

function NewIncidentDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const save = useSaveIncident();
  const [title, setTitle] = useState('');
  const [sev, setSev] = useState<Severity>('sev3');
  const [start, setStart] = useState(toLocal(new Date().toISOString()));
  useEffect(() => { if (open) { setTitle(''); setSev('sev3'); setStart(toLocal(new Date().toISOString())); } }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('New incident')}</DialogTitle>
          <DialogDescription>{t('Log it now and fill in the rest later: timeline, cause, actions and postmortem.')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={k('Title')}><Input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={k('Severity')}>
              <Select value={sev} onValueChange={v => setSev(v as Severity)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{SEVERITIES.map(s => <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={k('Started')}><Input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
          <Button disabled={!title.trim() || !start || save.isPending} onClick={() => save.mutate(
            { body: { title: title.trim(), severity: sev, startedAt: fromLocal(start)! } },
            { onSuccess: r => { onOpenChange(false); onCreated((r as { id: string }).id); } },
          )}>{save.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('Log it')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionsEditor({ value, onChange }: { value: IncidentAction[]; onChange: (v: IncidentAction[]) => void }) {
  const set = (i: number, patch: Partial<IncidentAction>) => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-1.5">
      {value.map((a, i) => (
        <div key={a.id} className="flex items-center gap-2">
          <Checkbox checked={a.done} onCheckedChange={c => set(i, { done: c === true })} aria-label={t('Done')} />
          <Input value={a.text} onChange={e => set(i, { text: e.target.value })} placeholder={t('Action')} className={cn('h-8 flex-1 text-xs', a.done && 'text-muted-foreground line-through')} maxLength={500} />
          <Input value={a.owner ?? ''} onChange={e => set(i, { owner: e.target.value })} placeholder={t('Owner')} className="h-8 w-32 text-xs" maxLength={80} />
          <Input type="date" value={a.due ?? ''} onChange={e => set(i, { due: e.target.value || undefined })} aria-label={t('Deadline')}
            className={cn('h-8 w-36 text-xs', !a.done && a.due && a.due < today && 'border-danger text-danger')} />
          <Button size="icon-xs" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t('Remove')}><X /></Button>
        </div>
      ))}
      <Button size="xs" variant="outline" onClick={() => onChange([...value, { id: newId(), text: '', done: false }])}><Plus /> {t('Action')}</Button>
    </div>
  );
}

function TimelineEditor({ value, onChange }: { value: Draft['timeline']; onChange: (v: Draft['timeline']) => void }) {
  const sorted = useMemo(() => value.map((e, i) => ({ e, i })).sort((a, b) => Date.parse(a.e.at) - Date.parse(b.e.at)), [value]);
  const set = (i: number, patch: Partial<Draft['timeline'][number]>) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-1.5">
      {sorted.map(({ e, i }) => (
        <div key={i} className="flex items-center gap-2">
          <Input type="datetime-local" value={toLocal(e.at)} onChange={ev => set(i, { at: fromLocal(ev.target.value) ?? e.at })} className="h-8 w-48 text-xs" />
          <Input value={e.text} onChange={ev => set(i, { text: ev.target.value })} className="h-8 flex-1 text-xs" maxLength={1000} placeholder={t('What happened at this point')} />
          <Button size="icon-xs" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t('Remove')}><X /></Button>
        </div>
      ))}
      <Button size="xs" variant="outline" onClick={() => onChange([...value, { at: new Date().toISOString(), text: '' }])}><Plus /> {t('Event')}</Button>
    </div>
  );
}

function IncidentDetail({ incident, onDeleted }: { incident: Incident; onDeleted: () => void }) {
  const save = useSaveIncident();
  const del = useDeleteIncident();
  const [d, setD] = useState<Draft>(() => draftOf(incident));
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => setD(draftOf(incident)), [incident]);
  const dirty = JSON.stringify(d) !== JSON.stringify(draftOf(incident));
  const up = (patch: Partial<Draft>) => setD(x => ({ ...x, ...patch }));
  const pm = (patch: Partial<Draft['postmortem']>) => setD(x => ({ ...x, postmortem: { ...x.postmortem, ...patch } }));
  const end = d.resolvedAt ?? d.mitigatedAt;

  const markdown = () => api.get<string>(`/api/incidents/${incident._id}/postmortem.md?lang=${getLang()}`);
  const copy = async () => { await navigator.clipboard.writeText(await markdown()); toast.success(t('Postmortem copied')); };
  const download = async () => {
    const blob = new Blob([await markdown()], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `postmortem-${incident.startedAt.slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b p-4">
        <Input value={d.title} onChange={e => up({ title: e.target.value })} className="h-9 min-w-64 flex-1 text-sm font-semibold" maxLength={200} aria-label={t('Title')} />
        <Select value={d.severity} onValueChange={v => up({ severity: v as Severity })}>
          <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
          <SelectContent>{SEVERITIES.map(s => <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={d.status} onValueChange={v => up({ status: v as IncidentStatus })}>
          <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
          <SelectContent>{(Object.keys(STATUS) as IncidentStatus[]).map(s => <SelectItem key={s} value={s}>{t(STATUS[s].label)}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" disabled={!dirty || save.isPending || !d.title.trim()} onClick={() => save.mutate({ id: incident._id, body: cleanDraft(d) })}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('Save')}
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-auto p-4">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Field label={k('Started')}><Input type="datetime-local" value={toLocal(d.startedAt)} onChange={e => up({ startedAt: fromLocal(e.target.value) ?? d.startedAt })} /></Field>
          <Field label={k('Detected')}><Input type="datetime-local" value={toLocal(d.detectedAt)} onChange={e => up({ detectedAt: fromLocal(e.target.value) })} /></Field>
          <Field label={k('Mitigated')}><Input type="datetime-local" value={toLocal(d.mitigatedAt)} onChange={e => up({ mitigatedAt: fromLocal(e.target.value) })} /></Field>
          <Field label={k('Resolved at')}><Input type="datetime-local" value={toLocal(d.resolvedAt)} onChange={e => up({ resolvedAt: fromLocal(e.target.value) })} /></Field>
        </section>
        {end && <p className="-mt-3 text-[11px] text-muted-foreground">{t('Duration: {d}', { d: dur(Date.parse(end) - Date.parse(d.startedAt)) })}{d.detectedAt ? ` · ${t('detected in {d}', { d: dur(Date.parse(d.detectedAt) - Date.parse(d.startedAt)) })}` : ''}</p>}

        <section className="grid gap-3 lg:grid-cols-2">
          <Field label={k('Impact (who was affected, how much, for how long)')}><Textarea value={d.impact ?? ''} onChange={e => up({ impact: e.target.value })} rows={3} maxLength={4000} /></Field>
          <div className="space-y-3">
            <Field label={k('Affected services (comma separated)')}>
              <Input value={d.services.join(', ')} onChange={e => up({ services: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={k('PRs/issues that caused it (one per line)')}><Textarea value={d.causeChanges.join('\n')} onChange={e => up({ causeChanges: lines(e.target.value) })} rows={2} className="font-mono text-[11px]" /></Field>
              <Field label={k('Fixes (one per line)')}><Textarea value={d.fixChanges.join('\n')} onChange={e => up({ fixChanges: lines(e.target.value) })} rows={2} className="font-mono text-[11px]" /></Field>
            </div>
          </div>
        </section>
        <p className="-mt-3 text-[11px] text-muted-foreground">{t('URLs under "caused it" count toward the change failure rate (Metrics → DORA).')}</p>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold">{t('Timeline')}</h3>
          <TimelineEditor value={d.timeline} onChange={timeline => up({ timeline })} />
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold">{t('Actions')}</h3>
          <ActionsEditor value={d.actions} onChange={actions => up({ actions })} />
        </section>

        <section className="space-y-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-semibold">{t('Postmortem')}</h3>
            <Select value={d.postmortem.status} onValueChange={v => pm({ status: v as PostmortemStatus })}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(PM) as PostmortemStatus[]).map(s => <SelectItem key={s} value={s}>{t(PM[s])}</SelectItem>)}</SelectContent>
            </Select>
            <Input value={d.postmortem.url ?? ''} onChange={e => pm({ url: e.target.value })} placeholder={t('Doc link (optional)')} className="h-8 min-w-48 flex-1 text-xs" />
            <Button size="xs" variant="outline" onClick={() => void copy()} disabled={dirty}><ClipboardCopy /> {t('Copy Markdown')}</Button>
            <Button size="xs" variant="outline" onClick={() => void download()} disabled={dirty}><Download /> .md</Button>
          </div>
          {dirty && <p className="text-[11px] text-muted-foreground">{t('Save to export the current version.')}</p>}
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label={k('What happened')}><Textarea value={d.postmortem.whatHappened ?? ''} onChange={e => pm({ whatHappened: e.target.value })} rows={3} /></Field>
            <Field label={k('Root cause')}><Textarea value={d.postmortem.rootCause ?? ''} onChange={e => pm({ rootCause: e.target.value })} rows={3} /></Field>
            <Field label={k('What went well')}><Textarea value={d.postmortem.wentWell ?? ''} onChange={e => pm({ wentWell: e.target.value })} rows={2} /></Field>
            <Field label={k('What went wrong')}><Textarea value={d.postmortem.wentWrong ?? ''} onChange={e => pm({ wentWrong: e.target.value })} rows={2} /></Field>
            <Field label={k('Lessons')} className="lg:col-span-2"><Textarea value={d.postmortem.lessons ?? ''} onChange={e => pm({ lessons: e.target.value })} rows={2} /></Field>
          </div>
          <p className="text-[11px] text-muted-foreground">{t('Blameless: describe systems and decisions, not people.')}</p>
        </section>

        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setConfirmDel(true)}><Trash2 /> {t('Delete incident')}</Button>
      </div>

      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete the incident?')}</AlertDialogTitle>
            <AlertDialogDescription>{t('The record, timeline, actions and postmortem are removed from the board. This cannot be undone.')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => del.mutate(incident._id, { onSuccess: onDeleted })}>{t('Delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function IncidentsView() {
  const q = useIncidents();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const items = q.data?.items ?? [];
  const a = q.data?.alerts;
  const current = items.find(i => i._id === selected) ?? items[0];

  if (q.data && !q.data.configured) {
    return <div className="rounded-xl border border-dashed"><EmptyState icon={Siren} title={t('MongoDB not configured')} description={t('Incidents are stored in the board\'s own MongoDB collection.')} /></div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {a && (a.open > 0 || a.overdueActions.length > 0 || a.postmortemPending.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning-soft/40 px-3 py-2 text-xs">
          <AlertTriangle className="size-4 text-warning" />
          {a.open > 0 && <Pill tone="danger">{t('{n} open', { n: a.open })}</Pill>}
          {a.overdueActions.length > 0 && <Pill tone="warning">{t('{n} late action(s)', { n: a.overdueActions.length })}</Pill>}
          {a.postmortemPending.length > 0 && <Pill tone="warning">{t('{n} pending postmortem(s)', { n: a.postmortemPending.length })}</Pill>}
          {a.actionsDoneRate !== null && <span className="text-muted-foreground">{t('{pct} of actions done', { pct: `${Math.round(a.actionsDoneRate * 100)}%` })}</span>}
        </div>
      )}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[22rem_1fr]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
          <header className="flex h-11 items-center gap-2 border-b px-3.5">
            <Siren className="size-4 text-muted-foreground" />
            <h2 className="text-[13px] font-semibold">{t('Incidents')}</h2>
            <Button size="xs" className="ml-auto" onClick={() => setCreating(true)}><Plus /> {t('New')}</Button>
          </header>
          <div className="min-h-0 flex-1 overflow-auto">
            {q.isLoading && <div className="space-y-2 p-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>}
            {q.data && !items.length && <EmptyState icon={Siren} title={t('No incidents logged')} description={t('Log every incident, even small ones. They are the basis for recovery time, change failure rate (DORA) and future SLOs.')} />}
            <ul className="divide-y">
              {items.map(i => (
                <li key={i._id}>
                  <button type="button" onClick={() => setSelected(i._id)} className={cn('w-full space-y-1 px-3.5 py-2.5 text-left hover:bg-muted/60', current?._id === i._id && 'bg-muted')}>
                    <span className="flex items-center gap-2">
                      <Pill tone={SEV_TONE[i.severity]}>{i.severity.toUpperCase()}</Pill>
                      <span className="min-w-0 flex-1 truncate text-[13px]">{i.title}</span>
                      <Pill tone={STATUS[i.status].tone}>{t(STATUS[i.status].label)}</Pill>
                    </span>
                    <span className="flex gap-2 text-[11px] text-muted-foreground">
                      <span>{fmtDay(i.startedAt.slice(0, 10))} · {ago(Date.parse(i.startedAt))}</span>
                      {i.actions.length > 0 && <span>· {t('{done}/{n} actions', { done: i.actions.filter(x => x.done).length, n: i.actions.length })}</span>}
                      <span>· {t('postmortem {s}', { s: t(PM[i.postmortem.status]) })}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className="min-h-0 overflow-hidden rounded-xl border bg-card shadow-xs">
          {current ? <IncidentDetail key={current._id} incident={current} onDeleted={() => setSelected(null)} />
            : !q.isLoading && <EmptyState icon={Siren} title={t('Select or log an incident')} />}
        </section>
      </div>
      <NewIncidentDialog open={creating} onOpenChange={setCreating} onCreated={setSelected} />
    </div>
  );
}
