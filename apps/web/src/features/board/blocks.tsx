// Blocos da tela "Hoje": Minha fila, Reviews pendentes, Daily, Bloqueios e PRs/deploy (resumo).
import { useMemo, useState } from 'react';
import {
  AlertCircle, ArrowUpRight, CheckCircle2, CircleSlash, GitPullRequest, Inbox, MessageSquareReply, MessagesSquare, Rocket,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BlockCard, Dot, EmptyState, Mono, Pill, type BlockStatus, type Tone } from '@/components/common';
import { useBlockers, useDaily, usePrs, useQueue, useReviews } from '@/hooks/use-board';
import type { PrSize, QueueItem, SourceState } from '@/lib/board-types';
import { STATUS_META } from '@/lib/board-types';
import { ago, dur, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

type GoTo = (view: 'settings' | 'deploy') => void;

/** Estado do bloco a partir da fonte e da consulta. */
function statusOf(q: { isLoading: boolean; error: unknown; refetch: () => unknown }, source: SourceState | undefined, what: string, goTo: GoTo): BlockStatus {
  if (q.isLoading) return { kind: 'loading' };
  if (q.error) return { kind: 'error', message: (q.error as Error).message, retry: () => void q.refetch() };
  if (source && !source.configured) return { kind: 'not_configured', what, onConfigure: () => goTo('settings') };
  if (source && !source.lastSync && source.running) return { kind: 'loading' };
  return { kind: 'ready' };
}

function SourceFooter({ source }: { source: SourceState | undefined }) {
  if (!source?.configured) return null;
  return (
    <div className={cn('flex items-center gap-1.5 border-t px-3.5 py-1.5 text-[11px] text-muted-foreground', source.error && 'text-danger')}>
      {source.error ? <AlertCircle className="size-3" /> : <Dot tone={source.running ? 'info' : 'success'} pulse={source.running} />}
      {source.error ? `Falha: ${source.error}` : source.running ? 'sincronizando…' : source.lastSync ? `sincronizado há ${ago(Date.parse(source.lastSync))}` : 'aguardando primeira sincronização'}
    </div>
  );
}

const rankTone = (rank: number): Tone => (rank === 0 ? 'danger' : rank === 1 ? 'danger' : rank === 2 ? 'warning' : rank === 3 ? 'info' : 'neutral');
const sizeTone: Record<PrSize, Tone> = { XS: 'neutral', S: 'neutral', M: 'info', L: 'warning', XL: 'danger' };

function Row({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <li>
      <a href={href} target="_blank" rel="noopener"
        className={cn('group flex items-center gap-2.5 px-3.5 py-[calc(var(--row-py)+0.25rem)] text-left outline-none hover:bg-muted/60 focus-visible:bg-muted/60', className)}>
        {children}
        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" />
      </a>
    </li>
  );
}

// ---------- Minha fila ----------
type QueueFilter = 'all' | 'top' | 'unanswered';

export function QueueBlock({ goTo, className }: { goTo: GoTo; className?: string }) {
  const q = useQueue();
  const [filter, setFilter] = useState<QueueFilter>('top');
  const items = useMemo(() => {
    const all = q.data?.items ?? [];
    if (filter === 'top') return all.filter(i => i.rank <= 3);
    if (filter === 'unanswered') return all.filter(i => i.reasons.includes('mentioned') && !i.answered);
    return all;
  }, [q.data, filter]);
  const total = q.data?.items.length ?? 0;
  const github = q.data?.source.github;

  return (
    <BlockCard icon={Inbox} title="Minha fila" count={total || undefined} className={className}
      status={statusOf(q, github, 'GitHub', goTo)}
      actions={
        <Tabs value={filter} onValueChange={v => setFilter(v as QueueFilter)}>
          <TabsList className="h-7">
            <TabsTrigger value="top" className="px-2 text-xs">Prioritários</TabsTrigger>
            <TabsTrigger value="unanswered" className="px-2 text-xs">Sem resposta</TabsTrigger>
            <TabsTrigger value="all" className="px-2 text-xs">Todos</TabsTrigger>
          </TabsList>
        </Tabs>
      }>
      {items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Nada aqui" description={filter === 'top' ? 'Nenhum Ticket, Bug, Ajuste ou Tarefa aberto para você.' : 'Nenhum item neste filtro.'} />
      ) : (
        <ul className="divide-y">{items.map(i => <QueueRow key={i.key} item={i} />)}</ul>
      )}
      <SourceFooter source={github} />
    </BlockCard>
  );
}

function QueueRow({ item: i }: { item: QueueItem }) {
  const created = Date.parse(i.createdAt);
  return (
    <Row href={i.url}>
      <Pill tone={rankTone(i.rank)} className="w-24 justify-center truncate" title={i.type}>{i.type}</Pill>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px]">{i.title}</p>
        <p className="truncate text-[11px] text-muted-foreground [&>*]:mr-1.5">
          {i.repo && <Mono className="text-[11px]">{i.repo.split('/')[1]}#{i.number}</Mono>}
          {i.source === 'discord' && <span>Discord · {i.labels[0]}</span>}
          {i.reasons.includes('assigned') && <span>· atribuído</span>}
          {i.reasons.includes('mentioned') && <span>· menção</span>}
        </p>
      </div>
      {i.reasons.includes('mentioned') && !i.answered && (
        <Tooltip>
          <TooltipTrigger asChild><MessageSquareReply className="size-3.5 shrink-0 text-warning" aria-label="Menção sem resposta sua" /></TooltipTrigger>
          <TooltipContent>Menção sem resposta sua</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild><span className="w-12 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">{ago(created)}</span></TooltipTrigger>
        <TooltipContent>Criado em {new Date(created).toLocaleString('pt-BR')}</TooltipContent>
      </Tooltip>
    </Row>
  );
}

// ---------- Reviews pendentes ----------
export function ReviewsBlock({ goTo, className }: { goTo: GoTo; className?: string }) {
  const q = useReviews();
  const items = q.data?.items ?? [];
  const late = items.filter(r => r.waitingBusinessDays > 1).length;
  return (
    <BlockCard icon={GitPullRequest} title="Reviews pendentes" count={items.length || undefined} countTone={late ? 'warning' : 'neutral'}
      className={className} status={statusOf(q, q.data?.source, 'GitHub', goTo)}
      actions={late > 0 ? <span className="text-[11px] text-warning">{late} há mais de 1 dia útil</span> : undefined}>
      {items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Nenhum review pendente" description="Quando pedirem seu review, o PR aparece aqui." />
      ) : (
        <ul className="divide-y">
          {items.map(r => (
            <Row key={r.key} href={r.url}>
              <Pill tone={sizeTone[r.size]} className="w-8 justify-center" title={`${r.lines} linhas alteradas`}>{r.size}</Pill>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]">{r.isDraft && <span className="mr-1 text-muted-foreground">[rascunho]</span>}{r.title}</p>
                <p className="truncate text-[11px] text-muted-foreground [&>*]:mr-1.5">
                  <Mono className="text-[11px]">{r.repo.split('/')[1]}#{r.number}</Mono>
                  <span>· {r.author ?? '?'}</span>
                  <span>· → <Mono className="text-[11px]">{r.base}</Mono></span>
                  <span className="text-success tabular-nums">+{r.additions}</span><span className="text-danger tabular-nums">−{r.deletions}</span>
                </p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn('w-14 shrink-0 text-right text-[11px] tabular-nums', r.waitingBusinessDays > 1 ? 'font-medium text-warning' : 'text-muted-foreground')}>
                    {r.waitingBusinessDays.toLocaleString('pt-BR')} d.u.
                  </span>
                </TooltipTrigger>
                <TooltipContent>Esperando seu review desde {new Date(r.waitingSince).toLocaleString('pt-BR')} (dias úteis)</TooltipContent>
              </Tooltip>
            </Row>
          ))}
        </ul>
      )}
      <SourceFooter source={q.data?.source} />
    </BlockCard>
  );
}

// ---------- Daily ----------
export function DailyBlock({ goTo, className }: { goTo: GoTo; className?: string }) {
  const q = useDaily();
  const s = q.data?.summary;
  const total = s?.people.length ?? 0;
  return (
    <BlockCard icon={MessagesSquare} title="Daily do time" className={className}
      count={s ? `${s.postedCount}/${total}` : undefined} countTone={s && s.missing.length ? 'warning' : 'success'}
      status={statusOf(q, q.data?.source, 'Discord', goTo)}>
      {!s ? <EmptyState icon={MessagesSquare} title="Sem dados ainda" description="Aguardando a primeira leitura do canal da daily." /> : (
        <div className="space-y-3 p-3.5 text-xs">
          {s.missing.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5"><span className="text-muted-foreground">Não postaram:</span>{s.missing.map(m => <Pill key={m.id} tone="warning">{m.name}</Pill>)}</p>
          )}
          {s.lowConfidence.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5"><span className="text-muted-foreground">Confiança baixa:</span>
              {s.lowConfidence.map(p => <Pill key={p.member.id} tone="danger">{p.member.name} {p.parsed?.confidence}/5</Pill>)}</p>
          )}
          <ul className="divide-y rounded-lg border">
            {s.people.filter(p => p.posted).map(p => (
              <li key={p.member.id} className="flex items-start gap-2 px-2.5 py-2">
                <span className="w-20 shrink-0 font-medium">{p.member.name}</span>
                <span className="min-w-0 flex-1 text-muted-foreground">
                  {p.parsed?.today.slice(0, 2).join(' / ') || '—'}
                  {(p.changes.newBlockers.length > 0 || p.changes.resolvedBlockers.length > 0 || p.changes.confidenceDelta) && (
                    <span className="mt-0.5 block text-[11px]">
                      {p.changes.newBlockers.length > 0 && <span className="text-danger">+{p.changes.newBlockers.length} bloqueio </span>}
                      {p.changes.resolvedBlockers.length > 0 && <span className="text-success">−{p.changes.resolvedBlockers.length} resolvido </span>}
                      {!!p.changes.confidenceDelta && <span>confiança {p.changes.confidenceDelta > 0 ? '+' : ''}{p.changes.confidenceDelta}</span>}
                    </span>
                  )}
                </span>
                {p.parsed?.confidence !== undefined && <Pill tone={p.lowConfidence ? 'danger' : 'neutral'}>{p.parsed.confidence}/5</Pill>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <SourceFooter source={q.data?.source} />
    </BlockCard>
  );
}

// ---------- Bloqueios ----------
export function BlockersBlock({ goTo, className }: { goTo: GoTo; className?: string }) {
  const q = useBlockers();
  const items = q.data?.items ?? [];
  return (
    <BlockCard icon={CircleSlash} title="Bloqueios do time" count={items.length || undefined} countTone="danger" className={className}
      status={statusOf(q, q.data?.source, 'Discord', goTo)}>
      {items.length === 0 ? <EmptyState icon={CheckCircle2} title="Ninguém travado" description="Bloqueios das dailies e dos canais aparecem aqui." /> : (
        <ul className="divide-y">
          {items.map(b => (
            <Row key={b.key} href={b.messageUrl ?? '#'}>
              <span className="w-20 shrink-0 text-xs font-medium">{b.member.name}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]">{b.text}</p>
                <p className="text-[11px] text-muted-foreground">
                  {b.issue && <Mono className="text-[11px]">#{b.issue} </Mono>}
                  {b.dependsOn && <>· depende de {b.dependsOn} </>}
                  · {b.source === 'daily' ? 'daily' : `canal ${b.channel}`}{b.inferred ? ' (detectado)' : ''}
                </p>
              </div>
              <span className={cn('shrink-0 text-[11px] tabular-nums', b.ageMs > 45 * 60_000 ? 'font-medium text-danger' : 'text-muted-foreground')}>{dur(b.ageMs)}</span>
            </Row>
          ))}
        </ul>
      )}
      <SourceFooter source={q.data?.source} />
    </BlockCard>
  );
}

// ---------- PRs e deploy (resumo) ----------
export function PrsBlock({ goTo, className }: { goTo: GoTo; className?: string }) {
  const q = usePrs();
  const open = (q.data?.items ?? []).filter(i => i.status !== 'merged');
  const overdue = open.filter(i => i.overdue).length;
  return (
    <BlockCard icon={Rocket} title="PRs e deploy" count={open.length || undefined} countTone={overdue ? 'danger' : 'neutral'} className={className}
      status={q.isLoading ? { kind: 'loading' } : q.error ? { kind: 'error', message: (q.error as Error).message, retry: () => void q.refetch() } : { kind: 'ready' }}
      actions={<Button size="xs" variant="ghost" onClick={() => goTo('deploy')}>Abrir acompanhamento</Button>}>
      {open.length === 0 ? <EmptyState icon={CheckCircle2} title="Nada em andamento" description="Issues com PRs abertos aparecem aqui." /> : (
        <ul className="divide-y">
          {open.slice(0, 8).map(i => (
            <li key={i._id}>
              <button type="button" onClick={() => goTo('deploy')} className="flex w-full items-center gap-2.5 px-3.5 py-[calc(var(--row-py)+0.25rem)] text-left hover:bg-muted/60">
                <Pill tone={STATUS_META[i.status].tone} className="w-36 justify-center">{STATUS_META[i.status].label}</Pill>
                <span className="min-w-0 flex-1 truncate text-[13px]">{i.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{i.owner} · {plural(i.prs.length, 'PR', 'PRs')}</span>
                {i.deployDate && <span className={cn('w-12 shrink-0 text-right text-[11px] tabular-nums', i.overdue ? 'font-medium text-danger' : 'text-muted-foreground')}>{i.deployDate.slice(8)}/{i.deployDate.slice(5, 7)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <SourceFooter source={q.data?.source} />
    </BlockCard>
  );
}
