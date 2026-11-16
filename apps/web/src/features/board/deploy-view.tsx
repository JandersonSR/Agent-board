// Acompanhamento de PRs e deploy por issue (substitui o painel de PRs anterior).
// Dados do GitHub atualizam sozinhos; data de deploy, time e responsável são editáveis aqui.
import { Fragment, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, ExternalLink, GitPullRequest, Info, Rocket } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, Mono, Pill } from '@/components/common';
import { usePatchPr, usePrs } from '@/hooks/use-board';
import { STATUS_META, type DeployStatus, type TrackedIssue } from '@/lib/board-types';
import { ago, dur } from '@/lib/format';
import { cn } from '@/lib/utils';

type Filter = 'open' | 'overdue' | DeployStatus | 'all';

function DeployDate({ issue }: { issue: TrackedIssue }) {
  const patch = usePatchPr();
  return (
    <Input type="date" defaultValue={issue.deployDate ?? ''} aria-label={`Data de deploy de ${issue.title}`}
      className={cn('h-7 w-[8.5rem] text-xs tabular-nums', issue.overdue && 'border-danger/50 text-danger')}
      onBlur={e => { const v = e.target.value; if (v && v !== issue.deployDate) patch.mutate({ id: issue._id, deployDate: v }); }} />
  );
}

function InlineText({ issue, field, placeholder }: { issue: TrackedIssue; field: 'team' | 'owner'; placeholder: string }) {
  const patch = usePatchPr();
  return (
    <Input defaultValue={issue[field] ?? ''} placeholder={placeholder} aria-label={placeholder}
      className="h-7 w-28 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-input focus-visible:border-input"
      onBlur={e => { const v = e.target.value.trim(); if (v !== (issue[field] ?? '')) patch.mutate({ id: issue._id, [field]: v }); }} />
  );
}

/** Tempo desde que entrou no status atual (entrada aberta mais recente do histórico). */
function timeInStatus(i: TrackedIssue): string {
  const last = i.statusHistory?.[i.statusHistory.length - 1];
  if (!last || last.leftAt || last.status !== i.status) return '—';
  return dur(Date.now() - Date.parse(last.enteredAt));
}

export function DeployView() {
  const [filter, setFilter] = useState<Filter>('open');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const q = usePrs(filter === 'all' || filter === 'merged');
  const items = useMemo(() => {
    const all = q.data?.items ?? [];
    if (filter === 'open') return all.filter(i => i.status !== 'merged');
    if (filter === 'overdue') return all.filter(i => i.overdue);
    if (filter === 'all') return all;
    return all.filter(i => i.status === filter);
  }, [q.data, filter]);
  const counts = useMemo(() => {
    const all = q.data?.items ?? [];
    return { open: all.filter(i => i.status !== 'merged').length, overdue: all.filter(i => i.overdue).length };
  }, [q.data]);
  const toggle = (id: string) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4">
      {q.data && !q.data.source.configured && (
        <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-xs">
          <Info className="mt-0.5 size-4 shrink-0 text-info" />
          <p>Sincronização automática desligada: defina <Mono>TEAM_GITHUB_LOGINS</Mono> no .env (login:nome do time). Até lá aparecem só os itens migrados e editados aqui.</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={filter} onValueChange={v => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="open">Em andamento <Pill className="ml-1">{counts.open}</Pill></TabsTrigger>
            <TabsTrigger value="overdue">Atrasados {counts.overdue > 0 && <Pill tone="danger" className="ml-1">{counts.overdue}</Pill>}</TabsTrigger>
            {(['review_queue', 'reviewing', 'rcs', 'waiting_approves', 'merged'] as const).map(s => (
              <TabsTrigger key={s} value={s}>{STATUS_META[s].label}</TabsTrigger>
            ))}
            <TabsTrigger value="all">Todos</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        {q.isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
          : items.length === 0 ? <EmptyState icon={Rocket} title="Nada neste filtro" />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr className="text-left">
                    <th className="w-8" /><th className="px-2 py-2 font-medium">Issue</th><th className="px-2 font-medium">Status</th>
                    <th className="px-2 font-medium">PRs</th><th className="px-2 font-medium">Responsável</th><th className="px-2 font-medium">Time</th>
                    <th className="px-2 font-medium">Deploy</th><th className="px-2 text-right font-medium">No status</th><th className="px-3 text-right font-medium">Atualizado</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map(i => {
                    const expanded = open.has(i._id);
                    return (
                      <Fragment key={i._id}>
                        <tr className={cn('hover:bg-muted/40', i.overdue && 'bg-danger-soft/40')}>
                          <td className="pl-2">
                            <button type="button" onClick={() => toggle(i._id)} aria-expanded={expanded} aria-label="Ver PRs" className="rounded p-1 hover:bg-accent">
                              <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
                            </button>
                          </td>
                          <td className="max-w-[28rem] px-2 py-2">
                            <div className="flex items-center gap-1.5">
                              {i.overdue && <AlertTriangle className="size-3.5 shrink-0 text-danger" aria-label="Atrasado" />}
                              <span className="truncate font-medium" title={i.title}>{i.title}</span>
                              {i.reference && <a href={i.reference} target="_blank" rel="noopener" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Abrir issue"><ExternalLink className="size-3.5" /></a>}
                            </div>
                            {i.source !== 'auto' && <span className="text-[10px] text-muted-foreground">{i.source === 'legacy' ? 'migrado' : 'manual'}</span>}
                          </td>
                          <td className="px-2"><Pill tone={STATUS_META[i.status].tone}>{STATUS_META[i.status].label}</Pill></td>
                          <td className="px-2">
                            <div className="flex gap-1">
                              {i.prs.filter(p => p.state !== 'closed').slice(0, 6).map(p => (
                                <a key={p.url} href={p.url} target="_blank" rel="noopener" title={`${p.title} · ${STATUS_META[p.status].label}`}>
                                  <Pill tone={STATUS_META[p.status].tone}><GitPullRequest className="size-3" />{p.base ?? p.title}</Pill>
                                </a>
                              ))}
                            </div>
                          </td>
                          <td className="px-1"><InlineText issue={i} field="owner" placeholder="Responsável" /></td>
                          <td className="px-1"><InlineText issue={i} field="team" placeholder="Time" /></td>
                          <td className="px-1"><DeployDate issue={i} /></td>
                          <td className="px-2 text-right tabular-nums text-muted-foreground">{timeInStatus(i)}</td>
                          <td className="px-3 text-right tabular-nums text-muted-foreground">{ago(Date.parse(i.updatedAt))}</td>
                        </tr>
                        {expanded && (
                          <tr className="bg-muted/30">
                            <td />
                            <td colSpan={8} className="px-2 py-2">
                              <ul className="space-y-1">
                                {i.prs.map(p => (
                                  <li key={p.url} className="flex items-center gap-2">
                                    <Pill tone={STATUS_META[p.status].tone} className="w-36 justify-center">{p.state === 'closed' ? 'Fechado' : STATUS_META[p.status].label}</Pill>
                                    <a href={p.url} target="_blank" rel="noopener" className="truncate hover:underline">{p.title}</a>
                                    {p.repo && <Mono className="text-[11px] text-muted-foreground">{p.repo.split('/')[1]}#{p.number} → {p.base}</Mono>}
                                    <span className="ml-auto text-muted-foreground">{p.owner}</span>
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </div>
  );
}
