// Acompanhamento de PRs e deploy por issue (substitui o painel de PRs anterior).
// Você informa a issue (ou ela vem do Project com data de deploy); os PRs ligados são encontrados
// e atualizados sozinhos. Data, time, responsável e o status de cada PR podem ser ajustados aqui.
import { Fragment, useMemo, useState } from 'react';
import {
  AlertTriangle, Archive, Check, ChevronRight, ExternalLink, GitPullRequest, Hand, Info, Loader2, MoreHorizontal, Plus, Rocket, Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState, Mono, Pill } from '@/components/common';
import { useArchiveIssue, usePatchPr, usePrs, useSetPrStatus, useTrackIssue } from '@/hooks/use-board';
import { DEPLOY_STATUSES, STATUS_META, type DeployStatus, type TrackedIssue, type TrackedPr } from '@/lib/board-types';
import { ago, dur } from '@/lib/format';
import { cn } from '@/lib/utils';

type Filter = 'open' | 'overdue' | DeployStatus | 'all';

const DATE_SOURCE: Record<string, string> = { project: 'do Project', manual: 'editada no painel', legacy: 'do painel antigo' };

function DeployDate({ issue }: { issue: TrackedIssue }) {
  const patch = usePatchPr();
  return (
    <div className="flex items-center gap-1">
      <Input type="date" defaultValue={issue.deployDate ?? ''} key={issue.deployDate ?? 'none'} aria-label={`Data de deploy de ${issue.title}`}
        className={cn('h-7 w-[8.5rem] text-xs tabular-nums', issue.overdue && 'border-danger/50 text-danger')}
        onBlur={e => { const v = e.target.value; if (v && v !== issue.deployDate) patch.mutate({ id: issue._id, deployDate: v }); }} />
      {issue.deployDateSource && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-[10px] text-muted-foreground">{issue.deployDateSource === 'project' ? 'Project' : issue.deployDateSource === 'manual' ? 'manual' : 'antigo'}</span>
          </TooltipTrigger>
          <TooltipContent>Data {DATE_SOURCE[issue.deployDateSource]}. Editar aqui faz a data do Project deixar de sobrescrever.</TooltipContent>
        </Tooltip>
      )}
    </div>
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

/** Chip do PR com menu para ajustar o status à mão (ex.: re-review). */
function PrChip({ issue, pr, wide = false }: { issue: TrackedIssue; pr: TrackedPr; wide?: boolean }) {
  const setStatus = useSetPrStatus();
  const meta = STATUS_META[pr.status];
  const manual = !!pr.statusOverride;
  const label = pr.state === 'closed' ? 'Fechado' : meta.label;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Status do PR ${pr.repo ?? ''}#${pr.number ?? ''}: ${label}`}>
          <Pill tone={pr.state === 'closed' ? 'neutral' : meta.tone} className={cn(wide && 'w-40 justify-center', manual && 'ring-2')}>
            {manual ? <Hand className="size-3" /> : <GitPullRequest className="size-3" />}
            {wide ? label : (pr.base ?? pr.title)}
          </Pill>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {pr.repo?.split('/')[1]}#{pr.number} → {pr.base}<br />
          GitHub: {STATUS_META[pr.derivedStatus ?? pr.status].label}{manual && ' · ajuste manual ativo'}
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => window.open(pr.url, '_blank', 'noopener')}><ExternalLink /> Abrir PR</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Ajustar status</DropdownMenuLabel>
        {DEPLOY_STATUSES.filter(s => s !== 'merged').map(s => (
          <DropdownMenuItem key={s} disabled={setStatus.isPending} onSelect={() => setStatus.mutate({ id: issue._id, url: pr.url, status: s })}>
            {pr.status === s ? <Check /> : <span className="size-4" />} {STATUS_META[s].label}
          </DropdownMenuItem>
        ))}
        {manual && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setStatus.mutate({ id: issue._id, url: pr.url, status: null })}><Undo2 /> Voltar ao automático</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TrackForm() {
  const track = useTrackIssue();
  const [issue, setIssue] = useState('');
  const [date, setDate] = useState('');
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={e => {
      e.preventDefault();
      if (!issue.trim()) return;
      track.mutate({ issue: issue.trim(), ...(date ? { deployDate: date } : {}) }, { onSuccess: () => { setIssue(''); setDate(''); } });
    }}>
      <Input value={issue} onChange={e => setIssue(e.target.value)} placeholder="Link da issue, org/repo#123 ou nº do board" aria-label="Issue para acompanhar" className="h-8 w-80 text-xs" />
      <Input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Data de deploy (opcional)" className="h-8 w-36 text-xs" />
      <Button size="sm" type="submit" disabled={track.isPending || !issue.trim()}>
        {track.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Acompanhar issue
      </Button>
    </form>
  );
}

function sinceStatus(i: TrackedIssue): string {
  const last = i.statusHistory?.[i.statusHistory.length - 1];
  if (!last || last.leftAt || last.status !== i.status) return '—';
  return dur(Date.now() - Date.parse(last.enteredAt));
}

export function DeployView() {
  const [filter, setFilter] = useState<Filter>('open');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const archive = useArchiveIssue();
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
    const by = Object.fromEntries(DEPLOY_STATUSES.map(s => [s, all.filter(i => i.status === s).length])) as Record<DeployStatus, number>;
    return { open: all.filter(i => i.status !== 'merged').length, overdue: all.filter(i => i.overdue).length, by };
  }, [q.data]);
  const toggle = (id: string) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TrackForm />
        <p className="text-xs text-muted-foreground">Os PRs ligados a cada issue (de qualquer autor e repo) entram e são atualizados sozinhos.</p>
      </div>

      {q.data && q.data.projectScope === false && (
        <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-xs">
          <Info className="mt-0.5 size-4 shrink-0 text-info" />
          <p>Datas do GitHub Project desligadas: o token não tem o escopo <Mono>read:project</Mono>. Rode <Mono>gh auth refresh -s read:project</Mono> e defina <Mono>GITHUB_PROJECTS</Mono> no .env. Até lá, informe a data aqui.</p>
        </div>
      )}

      <Tabs value={filter} onValueChange={v => setFilter(v as Filter)}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="open">Em andamento <Pill className="ml-1">{counts.open}</Pill></TabsTrigger>
          <TabsTrigger value="overdue">Atrasados {counts.overdue > 0 && <Pill tone="danger" className="ml-1">{counts.overdue}</Pill>}</TabsTrigger>
          {DEPLOY_STATUSES.map(s => (
            <TabsTrigger key={s} value={s}>{STATUS_META[s].label}{s !== 'merged' && counts.by[s] > 0 && <Pill tone={STATUS_META[s].tone} className="ml-1">{counts.by[s]}</Pill>}</TabsTrigger>
          ))}
          <TabsTrigger value="all">Todos</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        {q.isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
          : items.length === 0 ? <EmptyState icon={Rocket} title="Nada neste filtro" description="Use “Acompanhar issue” para começar a acompanhar uma entrega." />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr className="text-left">
                    <th className="w-8" /><th className="px-2 py-2 font-medium">Issue</th><th className="px-2 font-medium">Status</th>
                    <th className="px-2 font-medium">PRs</th><th className="px-2 font-medium">Responsável</th><th className="px-2 font-medium">Time</th>
                    <th className="px-2 font-medium">Deploy</th><th className="px-2 text-right font-medium">No status</th><th className="px-2 text-right font-medium">Atualizado</th><th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map(i => {
                    const expanded = open.has(i._id);
                    const live = i.prs.filter(p => p.state !== 'closed');
                    return (
                      <Fragment key={i._id}>
                        <tr className={cn('hover:bg-muted/40', i.overdue && 'bg-danger-soft/40')}>
                          <td className="pl-2">
                            <button type="button" onClick={() => toggle(i._id)} aria-expanded={expanded} aria-label="Ver PRs" className="rounded p-1 hover:bg-accent">
                              <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
                            </button>
                          </td>
                          <td className="max-w-[26rem] px-2 py-2">
                            <div className="flex items-center gap-1.5">
                              {i.overdue && <AlertTriangle className="size-3.5 shrink-0 text-danger" aria-label="Atrasado" />}
                              <span className="truncate font-medium" title={i.title}>{i.title}</span>
                              {i.reference && <a href={i.reference} target="_blank" rel="noopener" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Abrir issue"><ExternalLink className="size-3.5" /></a>}
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              {i.reference && <Mono className="text-[10px]">#{i.reference.split('/').pop()}</Mono>}
                              {i.source === 'legacy' && ' · migrado'}{i.source === 'manual' && ' · adicionada aqui'}
                              {i.issueState === 'CLOSED' && ' · issue fechada'}
                            </span>
                          </td>
                          <td className="px-2"><Pill tone={STATUS_META[i.status].tone}>{STATUS_META[i.status].label}</Pill></td>
                          <td className="px-2">
                            <div className="flex max-w-[22rem] flex-wrap gap-1">
                              {live.slice(0, 6).map(p => <PrChip key={p.url} issue={i} pr={p} />)}
                              {live.length > 6 && <button type="button" onClick={() => toggle(i._id)}><Pill>+{live.length - 6}</Pill></button>}
                              {live.length === 0 && <span className="text-muted-foreground">nenhum PR ainda</span>}
                            </div>
                          </td>
                          <td className="px-1"><InlineText issue={i} field="owner" placeholder="Responsável" /></td>
                          <td className="px-1"><InlineText issue={i} field="team" placeholder="Time" /></td>
                          <td className="px-1"><DeployDate issue={i} /></td>
                          <td className="px-2 text-right tabular-nums text-muted-foreground">{sinceStatus(i)}</td>
                          <td className="px-2 text-right tabular-nums text-muted-foreground">{ago(Date.parse(i.updatedAt))}</td>
                          <td className="pr-2">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button size="icon-xs" variant="ghost" aria-label="Mais ações"><MoreHorizontal /></Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {i.reference && <DropdownMenuItem onSelect={() => window.open(i.reference, '_blank', 'noopener')}><ExternalLink /> Abrir issue</DropdownMenuItem>}
                                <DropdownMenuItem onSelect={() => archive.mutate({ id: i._id, archived: true })}><Archive /> Parar de acompanhar</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="bg-muted/30">
                            <td />
                            <td colSpan={9} className="px-2 py-2">
                              <ul className="space-y-1">
                                {i.prs.map(p => (
                                  <li key={p.url} className="flex items-center gap-2">
                                    <PrChip issue={i} pr={p} wide />
                                    <a href={p.url} target="_blank" rel="noopener" className="truncate hover:underline">{p.title}</a>
                                    {p.repo && <Mono className="shrink-0 text-[11px] text-muted-foreground">{p.repo.split('/')[1]}#{p.number} → {p.base}</Mono>}
                                    {p.statusOverride && <span className="shrink-0 text-[10px] text-muted-foreground">(GitHub: {STATUS_META[p.statusOverride.basis].label})</span>}
                                    <span className="ml-auto shrink-0 text-muted-foreground">{p.owner}</span>
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
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Hand className="size-3" /> = status ajustado à mão. Ele volta ao automático sozinho quando o GitHub muda (novo review, aprovação ou merge).</p>
    </div>
  );
}
