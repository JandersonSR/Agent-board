// Blocks of the "Today" screen: My queue, Pending reviews, Daily, Blockers and PRs/deploys (summary).
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
import { isDone, STATUS_META } from '@/lib/board-types';
import { ago, dur, fmtDay, plural } from '@/lib/format';
import { k, locale, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ReviewActions } from '../runs/review-actions';
import { TaskActions } from '../runs/task-actions';
import { ActiveFilters, FilterMenu, usePeople } from '@/components/filter-menu';
import { applyFilters, facetValues, isEmpty, useFilters, type Filterable } from '@/lib/filters';
import type { ReviewItem, TrackedIssue } from '@/lib/board-types';

const queueFilterable = (i: QueueItem): Filterable => ({ authors: [i.author], repos: [i.repo], text: i.title });
const reviewFilterable = (r: ReviewItem): Filterable => ({ authors: [r.author], repos: [r.repo], text: r.title });
export const issueFilterable = (i: TrackedIssue): Filterable => ({
  authors: [...i.prs.filter(p => p.state !== 'closed').map(p => p.author ?? p.owner), i.owner],
  repos: i.prs.map(p => p.repo),
  teams: [i.team],
  text: `${i.title} ${i.reference ?? ''}`,
});

/** "filtered/total" count when there is a filter. */
const countLabel = (shown: number, total: number, filtered: boolean) => (filtered && shown !== total ? `${shown}/${total}` : total || undefined);

type GoTo = (view: 'settings' | 'deploy' | 'runs' | 'queue', runId?: string) => void;

/** Block state from the source and the query. */
export function statusOf(q: { isLoading: boolean; error: unknown; refetch: () => unknown }, source: SourceState | undefined, what: string, goTo: GoTo): BlockStatus {
  if (q.isLoading) return { kind: 'loading' };
  if (q.error) return { kind: 'error', message: (q.error as Error).message, retry: () => void q.refetch() };
  if (source && !source.configured) return { kind: 'not_configured', what: t(what), onConfigure: () => goTo('settings') };
  if (source && !source.lastSync && source.running) return { kind: 'loading' };
  return { kind: 'ready' };
}

export function SourceFooter({ source }: { source: SourceState | undefined }) {
  if (!source?.configured) return null;
  return (
    <div className={cn('flex items-center gap-1.5 border-t px-3.5 py-1.5 text-[11px] text-muted-foreground', source.error && 'text-danger')}>
      {source.error ? <AlertCircle className="size-3" /> : <Dot tone={source.running ? 'info' : 'success'} pulse={source.running} />}
      {source.error ? t('Failed: {error}', { error: source.error }) : source.running ? t('syncing…') : source.lastSync ? t('synced {time} ago', { time: ago(Date.parse(source.lastSync)) }) : t('waiting for the first sync')}
    </div>
  );
}

export const rankTone = (rank: number): Tone => (rank === 0 ? 'danger' : rank === 1 ? 'danger' : rank === 2 ? 'warning' : rank === 3 ? 'info' : 'neutral');
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
  const [filters, setFilters] = useFilters('queue');
  const people = usePeople().data;
  const all = q.data?.items ?? [];
  const options = useMemo(() => ({ author: facetValues(all, i => [i.author]), repo: facetValues(all, i => [i.repo]) }), [all]);
  const items = useMemo(() => {
    const byTab = filter === 'top' ? all.filter(i => i.rank <= 3)
      : filter === 'unanswered' ? all.filter(i => i.reasons.includes('mentioned') && !i.answered) : all;
    return applyFilters(byTab, queueFilterable, filters, people);
  }, [all, filter, filters, people]);
  const total = all.length;
  const github = q.data?.source.github;

  return (
    <BlockCard icon={Inbox} title={t('My queue')} count={countLabel(applyFilters(all, queueFilterable, filters, people).length, total, !isEmpty(filters))} className={className}
      status={statusOf(q, github, k('GitHub'), goTo)}
      actions={
        <>
          <FilterMenu filters={filters} onChange={setFilters} options={options} />
          <Button size="xs" variant="ghost" onClick={() => goTo('queue')}>{t('See all')}</Button>
          <Tabs value={filter} onValueChange={v => setFilter(v as QueueFilter)}>
            <TabsList className="h-7">
              <TabsTrigger value="top" className="px-2 text-xs">{t('Priority')}</TabsTrigger>
              <TabsTrigger value="unanswered" className="px-2 text-xs">{t('Unanswered')}</TabsTrigger>
              <TabsTrigger value="all" className="px-2 text-xs">{t('All')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </>
      }>
      <ActiveFilters filters={filters} onChange={setFilters} className="border-b px-3.5 py-1.5" />
      {items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t('Nothing here')} description={t(filter === 'top' ? 'No open ticket, bug, fix or task for you.' : 'No items in this filter.')} />
      ) : (
        <ul className="divide-y">{items.map(i => <QueueRow key={i.key} item={i} onStarted={id => goTo('runs', id)} />)}</ul>
      )}
      <SourceFooter source={github} />
    </BlockCard>
  );
}

export function QueueRow({ item: i, onStarted, extra }: { item: QueueItem; onStarted: (id: string) => void; extra?: React.ReactNode }) {
  const created = Date.parse(i.createdAt);
  const canTask = i.source === 'github' && i.kind === 'issue';
  const trailing = canTask || extra ? <div className="flex items-center gap-1">{extra}{canTask && <TaskActions url={i.url} title={i.title} onStarted={onStarted} />}</div> : undefined;
  return (
    <Row href={i.url} trailing={trailing}>
      <Pill tone={rankTone(i.rank)} className="w-24 justify-center truncate" title={i.type}>{i.type}</Pill>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px]">{i.title}</p>
        <p className="truncate text-[11px] text-muted-foreground [&>*]:mr-1.5">
          {i.repo && <Mono className="text-[11px]">{i.repo.split('/')[1]}#{i.number}</Mono>}
          {i.source !== 'github' && i.origin && <span>{i.origin}</span>}
          {i.reasons.includes('assigned') && <span>· {t('assigned')}</span>}
          {i.reasons.includes('mentioned') && <span>· {t('mention')}</span>}
        </p>
      </div>
      {i.reasons.includes('mentioned') && !i.answered && (
        <Tooltip>
          <TooltipTrigger asChild><MessageSquareReply className="size-3.5 shrink-0 text-warning" aria-label={t('Mention you have not answered')} /></TooltipTrigger>
          <TooltipContent>{t('Mention you have not answered')}</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild><span className="w-12 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">{ago(created)}</span></TooltipTrigger>
        <TooltipContent>{t('Created on {date}', { date: new Date(created).toLocaleString(locale()) })}</TooltipContent>
      </Tooltip>
    </Row>
  );
}

// ---------- Reviews pendentes ----------
export function ReviewsBlock({ goTo, className }: { goTo: GoTo; className?: string }) {
  const q = useReviews();
  const [filters, setFilters] = useFilters('reviews');
  const people = usePeople().data;
  const all = q.data?.items ?? [];
  const options = useMemo(() => ({ author: facetValues(all, r => [r.author]), repo: facetValues(all, r => [r.repo]) }), [all]);
  const items = useMemo(() => applyFilters(all, reviewFilterable, filters, people), [all, filters, people]);
  const late = items.filter(r => r.waitingBusinessDays > 1).length;
  return (
    <BlockCard icon={GitPullRequest} title={t('Pending reviews')} count={countLabel(items.length, all.length, !isEmpty(filters))} countTone={late ? 'warning' : 'neutral'}
      className={className} status={statusOf(q, q.data?.source, k('GitHub'), goTo)}
      actions={
        <>
          {late > 0 && <span className="text-[11px] text-warning">{t('{n} waiting over 1 business day', { n: late })}</span>}
          <FilterMenu filters={filters} onChange={setFilters} options={options} />
        </>
      }>
      <ActiveFilters filters={filters} onChange={setFilters} className="border-b px-3.5 py-1.5" />
      {items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t(all.length ? 'No PRs match these filters' : 'No pending reviews')} description={t(all.length ? 'Adjust or clear the filters.' : 'When someone requests your review, the PR shows up here.')} />
      ) : (
        <ul className="divide-y">
          {items.map(r => (
            <Row key={r.key} href={r.url} trailing={<ReviewActions url={r.url} title={`${r.repo.split('/')[1]}#${r.number} ${r.title}`} onStarted={id => goTo('runs', id)} />}>
              <Pill tone={sizeTone[r.size]} className="w-8 justify-center" title={t('{n} lines changed', { n: r.lines })}>{r.size}</Pill>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]">{r.isDraft && <span className="mr-1 text-muted-foreground">[{t('draft')}]</span>}{r.title}</p>
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
                    {t('{n} b.d.', { n: r.waitingBusinessDays.toLocaleString(locale()) })}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('Waiting for your review since {date} (business days)', { date: new Date(r.waitingSince).toLocaleString(locale()) })}</TooltipContent>
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
    <BlockCard icon={MessagesSquare} title={t('Team daily')} className={className}
      count={s ? `${s.postedCount}/${total}` : undefined} countTone={s && s.missing.length ? 'warning' : 'success'}
      status={statusOf(q, q.data?.source, q.data?.source?.provider ?? k('Team chat'), goTo)}>
      {!s ? <EmptyState icon={MessagesSquare} title={t('No data yet')} description={t('Waiting for the first read of the daily channel.')} /> : (
        <div className="space-y-3 p-3.5 text-xs">
          {s.missing.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5"><span className="text-muted-foreground">{t('Not posted:')}</span>{s.missing.map(m => <Pill key={m.id} tone="warning">{m.name}</Pill>)}</p>
          )}
          {s.lowConfidence.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5"><span className="text-muted-foreground">{t('Low confidence:')}</span>
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
                      {p.changes.newBlockers.length > 0 && <span className="text-danger">{t('+{n} blocker', { n: p.changes.newBlockers.length })} </span>}
                      {p.changes.resolvedBlockers.length > 0 && <span className="text-success">{t('−{n} resolved', { n: p.changes.resolvedBlockers.length })} </span>}
                      {!!p.changes.confidenceDelta && <span>{t('confidence {delta}', { delta: `${p.changes.confidenceDelta > 0 ? '+' : ''}${p.changes.confidenceDelta}` })}</span>}
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
    <BlockCard icon={CircleSlash} title={t('Team blockers')} count={items.length || undefined} countTone="danger" className={className}
      status={statusOf(q, q.data?.source, q.data?.source?.provider ?? k('Team chat'), goTo)}>
      {items.length === 0 ? <EmptyState icon={CheckCircle2} title={t('Nobody is blocked')} description={t('Blockers from dailies and channels show up here.')} /> : (
        <ul className="divide-y">
          {items.map(b => (
            <Row key={b.key} href={b.messageUrl ?? '#'}>
              <span className="w-20 shrink-0 text-xs font-medium">{b.member.name}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]">{b.text}</p>
                <p className="text-[11px] text-muted-foreground">
                  {b.issue && <Mono className="text-[11px]">#{b.issue} </Mono>}
                  {b.dependsOn && <>· {t('depends on {who}', { who: b.dependsOn })} </>}
                  · {b.source === 'daily' ? 'daily' : t('channel {name}', { name: b.channel ?? '' })}{b.inferred ? ` (${t('detected')})` : ''}
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

// ---------- PRs and deploys (summary) ----------
export function PrsBlock({ goTo, className }: { goTo: GoTo; className?: string }) {
  const q = usePrs();
  // Same (saved) filters as the PRs and deploys screen.
  const [filters, setFilters] = useFilters('deploy');
  const people = usePeople().data;
  const allOpen = useMemo(() => (q.data?.items ?? []).filter(i => !isDone(i.status)), [q.data]);
  const options = useMemo(() => ({
    author: facetValues(allOpen, i => issueFilterable(i).authors), repo: facetValues(allOpen, i => issueFilterable(i).repos),
    team: facetValues(allOpen, i => [i.team]),
  }), [allOpen]);
  const open = useMemo(() => applyFilters(allOpen, issueFilterable, filters, people), [allOpen, filters, people]);
  const overdue = open.filter(i => i.overdue).length;
  return (
    <BlockCard icon={Rocket} title={t('PRs and deploys')} count={countLabel(open.length, allOpen.length, !isEmpty(filters))} countTone={overdue ? 'danger' : 'neutral'} className={className}
      status={q.isLoading ? { kind: 'loading' } : q.error ? { kind: 'error', message: (q.error as Error).message, retry: () => void q.refetch() } : { kind: 'ready' }}
      actions={
        <>
          <FilterMenu filters={filters} onChange={setFilters} options={options} />
          <Button size="xs" variant="ghost" onClick={() => goTo('deploy')}>{t('Open tracking')}</Button>
        </>
      }>
      <ActiveFilters filters={filters} onChange={setFilters} className="border-b px-3.5 py-1.5" />
      {open.length === 0 ? <EmptyState icon={CheckCircle2} title={t('Nothing in progress')} description={t('Issues with open PRs show up here.')} /> : (
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
