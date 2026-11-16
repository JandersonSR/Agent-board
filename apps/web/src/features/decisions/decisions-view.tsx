// Registro de decisões do time: design docs, RFCs e ADRs, com prazo para decidir.
// Os ADRs dos repositórios são importados dos clones locais (título e status vêm do arquivo).
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileDown, Landmark, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState, Mono, Pill, type Tone } from '@/components/common';
import {
  DECISION_STATUSES, useDecisions, useDeleteDecision, useImportAdrs, useSaveDecision,
  type Decision, type DecisionInput, type DecisionKind, type DecisionStatus,
} from '@/hooks/use-staff';
import { fmtDay } from '@/lib/format';
import { k, t } from '@/lib/i18n';
import { usePref } from '@/lib/prefs';
import { cn } from '@/lib/utils';

const STATUS: Record<DecisionStatus, { label: string; tone: Tone }> = {
  proposed: { label: k('proposta'), tone: 'info' }, discussing: { label: k('em discussão'), tone: 'warning' },
  decided: { label: k('decidida'), tone: 'success' }, rejected: { label: k('rejeitada'), tone: 'neutral' }, superseded: { label: k('substituída'), tone: 'neutral' },
};
const KIND: Record<DecisionKind, string> = { adr: 'ADR', design_doc: k('Design doc'), rfc: 'RFC' };
const OPEN: DecisionStatus[] = ['proposed', 'discussing'];
type Filter = 'open' | 'decided' | 'all';
const today = () => new Date().toISOString().slice(0, 10);

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={cn('space-y-1', className)}><Label className="text-xs text-muted-foreground">{t(label)}</Label>{children}</div>;
}

function DecisionDialog({ decision, open, onOpenChange }: { decision: Decision | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const save = useSaveDecision();
  const del = useDeleteDecision();
  const fromRepo = decision?.source === 'repo';
  const empty: DecisionInput = { title: '', kind: 'design_doc', status: 'proposed', owner: '', deciders: [], url: '', context: '', decision: '', decideBy: '' };
  const [d, setD] = useState<DecisionInput>(empty);
  useEffect(() => {
    if (!open) return;
    setD(decision ? {
      title: decision.title, kind: decision.kind, status: decision.status, owner: decision.owner ?? '', deciders: decision.deciders ?? [],
      url: decision.url ?? '', context: decision.context ?? '', decision: decision.decision ?? '', decideBy: decision.decideBy ?? '',
    } : empty);
  }, [open, decision]); // eslint-disable-line react-hooks/exhaustive-deps
  const up = (p: DecisionInput) => setD(x => ({ ...x, ...p }));
  const body = (): DecisionInput => {
    const out: DecisionInput = { ...d };
    for (const key of ['owner', 'url', 'context', 'decision', 'decideBy'] as const) if (!out[key]?.trim()) delete out[key];
    if (fromRepo) { delete out.title; delete out.status; delete out.kind; }
    return out;
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(decision ? 'Editar decisão' : 'Nova decisão')}</DialogTitle>
          <DialogDescription>
            {fromRepo ? t('ADR importado de {repo}: título e status vêm do arquivo. Dono, prazo e contexto ficam no painel.', { repo: decision!.repo ?? '' })
              : t('Uma decisão aberta precisa de dono e prazo. Sem prazo, ela fica parada e vira débito.')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-6">
          <Field label={k('Título')} className="sm:col-span-6"><Input value={d.title ?? ''} onChange={e => up({ title: e.target.value })} disabled={fromRepo} maxLength={300} /></Field>
          <Field label={k('Tipo')} className="sm:col-span-2">
            <Select value={d.kind} onValueChange={v => up({ kind: v as DecisionKind })} disabled={fromRepo}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(KIND) as DecisionKind[]).map(x => <SelectItem key={x} value={x}>{t(KIND[x])}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={k('Status')} className="sm:col-span-2">
            <Select value={d.status} onValueChange={v => up({ status: v as DecisionStatus })} disabled={fromRepo}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{DECISION_STATUSES.map(s => <SelectItem key={s} value={s}>{t(STATUS[s].label)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={k('Decidir até')} className="sm:col-span-2"><Input type="date" value={d.decideBy ?? ''} onChange={e => up({ decideBy: e.target.value })} /></Field>
          <Field label={k('Dono')} className="sm:col-span-2"><Input value={d.owner ?? ''} onChange={e => up({ owner: e.target.value })} maxLength={80} /></Field>
          <Field label={k('Quem decide (separados por vírgula)')} className="sm:col-span-4">
            <Input value={(d.deciders ?? []).join(', ')} onChange={e => up({ deciders: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} />
          </Field>
          <Field label={k('Link do documento')} className="sm:col-span-6"><Input value={d.url ?? ''} onChange={e => up({ url: e.target.value })} placeholder="https://" /></Field>
          <Field label={k('Contexto (o problema e as opções)')} className="sm:col-span-3"><Textarea value={d.context ?? ''} onChange={e => up({ context: e.target.value })} rows={4} maxLength={4000} /></Field>
          <Field label={k('Decisão e consequências')} className="sm:col-span-3"><Textarea value={d.decision ?? ''} onChange={e => up({ decision: e.target.value })} rows={4} maxLength={4000} /></Field>
        </div>
        <DialogFooter className="sm:justify-between">
          {decision ? <Button variant="ghost" className="text-danger" onClick={() => del.mutate(decision._id, { onSuccess: () => onOpenChange(false) })}><Trash2 /> {t('Apagar')}</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Cancelar')}</Button>
            <Button disabled={!d.title?.trim() || save.isPending} onClick={() => save.mutate({ ...(decision ? { id: decision._id } : {}), body: body() }, { onSuccess: () => onOpenChange(false) })}>
              {save.isPending && <Loader2 className="animate-spin" />} {t('Salvar')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DecisionsView() {
  const q = useDecisions();
  const imp = useImportAdrs();
  const [filter, setFilter] = usePref<Filter>('decisions.filter', 'open');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Decision | null | undefined>(undefined);
  const a = q.data?.alerts;
  const now = today();

  const items = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.items ?? [])
      .filter(d => filter === 'all' || (filter === 'open' ? OPEN.includes(d.status) : !OPEN.includes(d.status)))
      .filter(d => !s || `${d.title} ${d.owner ?? ''} ${d.repo ?? ''}`.toLowerCase().includes(s))
      .sort((x, y) => Number(OPEN.includes(y.status)) - Number(OPEN.includes(x.status)) || (x.decideBy ?? '9999').localeCompare(y.decideBy ?? '9999') || y.updatedAt.localeCompare(x.updatedAt));
  }, [q.data, filter, search]);

  if (q.data && !q.data.configured) {
    return <div className="rounded-xl border border-dashed"><EmptyState icon={Landmark} title={t('MongoDB não configurado')} description={t('O registro de decisões fica numa coleção própria do painel no MongoDB.')} /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={filter} onValueChange={v => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="open">{t('Abertas')}{a ? ` (${a.open})` : ''}</TabsTrigger>
            <TabsTrigger value="decided">{t('Encerradas')}</TabsTrigger>
            <TabsTrigger value="all">{t('Todas')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative">
          <Search className="absolute top-2 left-2 size-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Buscar título, dono ou repositório')} className="h-8 w-64 pl-8 text-xs" />
        </div>
        {a && a.overdue > 0 && <Pill tone="danger">{t('{n} com prazo vencido', { n: a.overdue })}</Pill>}
        {a && a.dueSoon > 0 && <Pill tone="warning">{t('{n} vencem em 7 dias', { n: a.dueSoon })}</Pill>}
        {a && a.stale > 0 && <Pill tone="warning">{t('{n} paradas há mais de 3 semanas', { n: a.stale })}</Pill>}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => imp.mutate()} disabled={imp.isPending}>
            {imp.isPending ? <Loader2 className="animate-spin" /> : <FileDown />} {t('Importar ADRs dos repositórios')}
          </Button>
          <Button size="sm" onClick={() => setEditing(null)}><Plus /> {t('Nova decisão')}</Button>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
        {q.isLoading && <div className="space-y-2 p-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>}
        {q.data && !items.length && (
          <EmptyState icon={Landmark} title={t(filter === 'open' ? 'Nenhuma decisão aberta' : 'Nenhuma decisão aqui')}
            description={t('Registre design docs e RFCs em discussão, com dono e prazo, ou importe os ADRs que já estão nos repositórios.')} />
        )}
        {items.length > 0 && (
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground"><tr className="border-b text-left">
                <th className="px-4 py-2 font-medium">{t('Decisão')}</th><th className="px-3 font-medium">{t('Tipo')}</th><th className="px-3 font-medium">{t('Status')}</th>
                <th className="px-3 font-medium">{t('Dono')}</th><th className="px-3 font-medium">{t('Prazo')}</th><th className="px-3 font-medium">{t('Origem')}</th><th className="w-16" />
              </tr></thead>
              <tbody>
                {items.map(d => {
                  const overdue = OPEN.includes(d.status) && !!d.decideBy && d.decideBy < now;
                  return (
                    <tr key={d._id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="max-w-md px-4 py-2"><button type="button" className="truncate text-left font-medium hover:underline" onClick={() => setEditing(d)}>{d.title}</button></td>
                      <td className="px-3">{t(KIND[d.kind])}</td>
                      <td className="px-3"><Pill tone={STATUS[d.status].tone}>{t(STATUS[d.status].label)}</Pill></td>
                      <td className="px-3">{d.owner ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className={cn('px-3 tabular-nums', overdue && 'font-medium text-danger')}>
                        {d.decideBy ? fmtDay(d.decideBy, true) : d.decidedAt ? <span className="text-muted-foreground">{t('decidida {date}', { date: fmtDay(d.decidedAt, true) })}</span> : d.date ? <span className="text-muted-foreground">{fmtDay(d.date, true)}</span> : '—'}
                      </td>
                      <td className="px-3">{d.source === 'repo' ? <Mono className="text-[11px]" title={d.path}>{d.repo}</Mono> : <span className="text-muted-foreground">{t('manual')}</span>}</td>
                      <td className="px-2 text-right">
                        {d.url && <Button size="icon-xs" variant="ghost" onClick={() => window.open(d.url, '_blank', 'noopener')} aria-label={t('Abrir documento')}><ExternalLink /></Button>}
                        <Button size="icon-xs" variant="ghost" onClick={() => setEditing(d)} aria-label={t('Editar')}><Pencil /></Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-[11px] text-muted-foreground">{t('A importação lê só arquivos .md em pastas de ADR (docs/adr, docs/decisions…) dos clones locais. Nada é escrito nos repositórios.')}</p>
      <DecisionDialog decision={editing ?? null} open={editing !== undefined} onOpenChange={o => { if (!o) setEditing(undefined); }} />
    </div>
  );
}
