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
import { ago, dur, fmtDay, plural } from '@/lib/format';
import { k, locale, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ReviewActions } from '../runs/review-actions';
import { TaskActions } from '../runs/task-actions';

type GoTo = (view: 'settings' | 'deploy' | 'runs', runId?: string) => void;

/** Estado do bloco a partir da fonte e da consulta. */
function statusOf(q: { isLoading: boolean; error: unknown; refetch: () => unknown }, source: SourceState | undefined, what: string, goTo: GoTo): BlockStatus {
  if (q.isLoading) return { kind: 'loading' };
  if (q.error) return { kind: 'error', message: (q.error as Error).message, retry: () => void q.refetch() };
  if (source && !source.configured) return { kind: 'not_configured', what: t(what), onConfigure: () => goTo('settings') };
  if (source && !source.lastSync && source.running) return { kind: 'loading' };
  return { kind: 'ready' };
}

function SourceFooter({ source }: { source: SourceState | undefined }) {
  if (!source?.configured) return null;
  return (
    <div className={cn('flex items-center gap-1.5 border-t px-3.5 py-1.5 text-[11px] text-muted-foreground', source.error && 'text-danger')}>
      {source.error ? <AlertCircle className="size-3" /> : <Dot tone={source.running ? 'info' : 'success'} pulse={source.running} />}
      {source.error ? t('Falha: {error}', { error: source.error }) : source.running ? t('sincronizando…') : source.lastSync ? t('sincronizado há {time}', { time: ago(Date.parse(source.lastSync)) }) : t('aguardando primeira sincronização')}
    </div>
  );
}

const rankTone = (rank: number): Tone => (rank === 0 ? 'danger' : rank === 1 ? 'danger' : rank === 2 ? 'warning' : rank === 3 ? 'info' : 'neutral');
const sizeTone: Record<PrSize, Tone> = { XS: 'neutral', S: 'neutral', M: 'info', L: 'warning', XL: 'danger' };

function Row({ href, children, className, trailing }: { href: string; children: React.ReactNode; className?: string; trailing?: React.ReactNode }) {
  return (
    <li className="group flex items-center hover:bg-muted/60">
      <a href={href} target="_blank" rel="noopener"
        className={cn('flex min-w-0 flex-1 items-center gap-2.5 py-[calc(var(--row-py)+0.25rem)] pl-3.5 text-left outline-none focus-visible:bg-muted/60', trailing ? 'pr-1' : 'pr-3.5', className)}>
        {children}
        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" />
      </a>
      {trailing && <div className="shrink-0 pr-2">{trailing}</div>}
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
    <BlockCard icon={Inbox} title={t('Minha fila')} count={total || undefined} className={className}
      status={statusOf(q, github, k('GitHub'), goTo)}
      actions={
        <Tabs value={filter} onValueChange={v => setFilter(v as QueueFilter)}>
          <TabsList className="h-7">
            <TabsTrigger value="top" className="px-2 text-xs">{t('Prioritários')}</TabsTrigger>
            <TabsTrigger value="unanswered" className="px-2 text-xs">{t('Sem resposta')}</TabsTrigger>
            <TabsTrigger value="all" className="px-2 text-xs">{t('Todos')}</TabsTrigger>
          </TabsList>
        </Tabs>
      }>
      {items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t('Nada aqui')} description={t(filter === 'top' ? 'Nenhum Ticket, Bug, Ajuste ou Tarefa aberto para você.' : 'Nenhum item neste filtro.')} />
      ) : (
        <ul className="divide-y">{items.map(i => <QueueRow key={i.key} item={i} onStarted={id => goTo('runs', id)} />)}</ul>
      )}
      <SourceFooter source={github} />
    </BlockCard>
  );
}

function QueueRow({ item: i, onStarted }: { item: QueueItem; onStarted: (id: string) => void }) {
  const created = Date.parse(i.createdAt);
  const canTask = i.source === 'github' && i.kind === 'issue';
  return (
    <Row href={i.url} trailing={canTask ? <TaskActions url={i.url} title={i.title} onStarted={onStarted} /> : undefined}>
      <Pill tone={rankTone(i.rank)} className="w-24 justify-center truncate" title={i.type}>{i.type}</Pill>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px]">{i.title}</p>
        <p className="truncate text-[11px] text-muted-foreground [&>*]:mr-1.5">
          {i.repo && <Mono className="text-[11px]">{i.repo.split('/')[1]}#{i.number}</Mono>}
          {i.source === 'discord' && <span>Discord · {i.labels[0]}</span>}
          {i.reasons.includes('assigned') && <span>· {t('atribuído')}</span>}
          {i.reasons.includes('mentioned') && <span>· {t('menção')}</span>}
        </p>
      </div>
      {i.reasons.includes('mentioned') && !i.answered && (
        <Tooltip>
          <TooltipTrigger asChild><MessageSquareReply className="size-3.5 shrink-0 text-warning" aria-label={t('Menção sem resposta sua')} /></TooltipTrigger>
          <TooltipContent>{t('Menção sem resposta sua')}</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild><span className="w-12 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">{ago(created)}</span></TooltipTrigger>
        <TooltipContent>{t('Criado em {date}', { date: new Date(created).toLocaleString(locale()) })}</TooltipContent>
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
    <BlockCard icon={GitPullRequest} title={t('Reviews pendentes')} count={items.length || undefined} countTone={late ? 'warning' : 'neutral'}
      className={className} status={statusOf(q, q.data?.source, k('GitHub'), goTo)}
      actions={late > 0 ? <span className="text-[11px] text-warning">{t('{n} há mais de 1 dia útil', { n: late })}</span> : undefined}>
      {items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t('Nenhum review pendente')} description={t('Quando pedirem seu review, o PR aparece aqui.')} />
      ) : (
        <ul className="divide-y">
          {items.map(r => (
            <Row key={r.key} href={r.url} trailing={<ReviewActions url={r.url} title={`${r.repo.split('/')[1]}#${r.number} ${r.title}`} onStarted={id => goTo('runs', id)} />}>
              <Pill tone={sizeTone[r.size]} className="w-8 justify-center" title={t('{n} linhas alteradas', { n: r.lines })}>{r.size}</Pill>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]">{r.isDraft && <span className="mr-1 text-muted-foreground">[{t('rascunho')}]</span>}{r.title}</p>
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
                    {t('{n} d.u.', { n: r.waitingBusinessDays.toLocaleString(locale()) })}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('Esperando seu review desde {date} (dias úteis)', { date: new Date(r.waitingSince).toLocaleString(locale()) })}</TooltipContent>
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
    <BlockCard icon={MessagesSquare} title={t('Daily do time')} className={className}
      count={s ? `${s.postedCount}/${total}` : undefined} countTone={s && s.missing.length ? 'warning' : 'success'}
      status={statusOf(q, q.data?.source, k('Discord'), goTo)}>
      {!s ? <EmptyState icon={MessagesSquare} title={t('Sem dados ainda')} description={t('Aguardando a primeira leitura do canal da daily.')} /> : (
        <div className="space-y-3 p-3.5 text-xs">
          {s.missing.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5"><span className="text-muted-foreground">{t('Não postaram:')}</span>{s.missing.map(m => <Pill key={m.id} tone="warning">{m.name}</Pill>)}</p>
          )}
          {s.lowConfidence.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5"><span className="text-muted-foreground">{t('Confiança baixa:')}</span>
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
                      {p.changes.newBlockers.length > 0 && <span className="text-danger">{t('+{n} bloqueio', { n: p.changes.newBlockers.length })} </span>}
                      {p.changes.resolvedBlockers.length > 0 && <span className="text-success">{t('−{n} resolvido', { n: p.changes.resolvedBlockers.length })} </span>}
                      {!!p.changes.confidenceDelta && <span>{t('confiança {delta}', { delta: `${p.changes.confidenceDelta > 0 ? '+' : ''}${p.changes.confidenceDelta}` })}</span>}
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
    <BlockCard icon={CircleSlash} title={t('Bloqueios do time')} count={items.length || undefined} countTone="danger" className={className}
      status={statusOf(q, q.data?.source, k('Discord'), goTo)}>
      {items.length === 0 ? <EmptyState icon={CheckCircle2} title={t('Ninguém travado')} description={t('Bloqueios das dailies e dos canais aparecem aqui.')} /> : (
        <ul className="divide-y">
          {items.map(b => (
            <Row key={b.key} href={b.messageUrl ?? '#'}>
              <span className="w-20 shrink-0 text-xs font-medium">{b.member.name}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]">{b.text}</p>
                <p className="text-[11px] text-muted-foreground">
                  {b.issue && <Mono className="text-[11px]">#{b.issue} </Mono>}
                  {b.dependsOn && <>· {t('depende de {who}', { who: b.dependsOn })} </>}
                  · {b.source === 'daily' ? 'daily' : t('canal {name}', { name: b.channel ?? '' })}{b.inferred ? ` (${t('detectado')})` : ''}
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
    <BlockCard icon={Rocket} title={t('PRs e deploy')} count={open.length || undefined} countTone={overdue ? 'danger' : 'neutral'} className={className}
      status={q.isLoading ? { kind: 'loading' } : q.error ? { kind: 'error', message: (q.error as Error).message, retry: () => void q.refetch() } : { kind: 'ready' }}
      actions={<Button size="xs" variant="ghost" onClick={() => goTo('deploy')}>{t('Abrir acompanhamento')}</Button>}>
      {open.length === 0 ? <EmptyState icon={CheckCircle2} title={t('Nada em andamento')} description={t('Issues com PRs abertos aparecem aqui.')} /> : (
        <ul className="divide-y">
          {open.slice(0, 8).map(i => (
            <li key={i._id}>
              <button type="button" onClick={() => goTo('deploy')} className="flex w-full items-center gap-2.5 px-3.5 py-[calc(var(--row-py)+0.25rem)] text-left hover:bg-muted/60">
                <Pill tone={STATUS_META[i.status].tone} className="w-36 justify-center">{t(STATUS_META[i.status].label)}</Pill>
                <span className="min-w-0 flex-1 truncate text-[13px]">{i.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{i.owner} · {plural(i.prs.length, 'PR', 'PRs')}</span>
                {i.deployDate && <span className={cn('w-12 shrink-0 text-right text-[11px] tabular-nums', i.overdue ? 'font-medium text-danger' : 'text-muted-foreground')}>{fmtDay(i.deployDate)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <SourceFooter source={q.data?.source} />
    </BlockCard>
  );
}
