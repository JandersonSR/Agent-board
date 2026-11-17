// The whole queue: tickets, bugs, fixes, tasks and whatever else is assigned to you or mentions you, from GitHub,
// Jira, Linear and the team chat. One tab per type (in the QUEUE_TYPE_ORDER priority), then text, origin,
// "unanswered" and order. An issue can become an incident in one click.
import { useMemo, useState } from 'react';
import { CheckCircle2, Inbox, MessageSquareReply, Search, Siren, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/common';
import { ActiveFilters, FilterMenu, usePeople } from '@/components/filter-menu';
import { useQueue } from '@/hooks/use-board';
import { useSaveIncident } from '@/hooks/use-staff';
import type { QueueItem } from '@/lib/board-types';
import { k, t } from '@/lib/i18n';
import { applyFilters, facetValues, isEmpty, useFilters, type Filterable } from '@/lib/filters';
import { usePref } from '@/lib/prefs';
import { QueueRow, SourceFooter } from '../board/blocks';
import { filterQueue, typeTabs, type QueueOrigin, type QueueSort } from './queue-filter';

const SORT_LABEL: Record<QueueSort, string> = { priority: k('Type priority'), oldest: k('Oldest first'), stale: k('Longest without update') };
const ORIGIN_LABEL: Record<Exclude<QueueOrigin, 'all'>, string> = { github: 'GitHub', jira: 'Jira', linear: 'Linear', chat: k('Chat') };
const filterable = (i: QueueItem): Filterable => ({ authors: [i.author], repos: [i.repo], text: i.title });

type Target = 'runs' | 'incidents' | 'settings';

export function QueueView({ goTo }: { goTo: (v: Target, id?: string) => void }) {
  const q = useQueue();
  const saveIncident = useSaveIncident();
  const people = usePeople().data;
  const [typePref, setType] = usePref<string>('queue.type', 'all');
  const [sort, setSort] = usePref<QueueSort>('queue.sort', 'priority');
  const [query, setQuery] = useState('');
  const [originPref, setOrigin] = useState<QueueOrigin>('all');
  const [unanswered, setUnanswered] = useState(false);
  const [filters, setFilters] = useFilters('queue');

  const all = useMemo(() => q.data?.items ?? [], [q.data]);
  // Person/repo filters are shared with the "My queue" block on Today.
  const base = useMemo(() => applyFilters(all, filterable, filters, people), [all, filters, people]);
  const tabs = useMemo(() => typeTabs(base), [base]);
  const type = typePref === 'all' || tabs.some(x => x.id === typePref) ? typePref : 'all';
  const origins = useMemo(() => [...new Set(all.map(i => i.source))], [all]);
  const origin = originPref === 'all' || origins.includes(originPref) ? originPref : 'all';
  const options = useMemo(() => ({ author: facetValues(all, i => [i.author]), repo: facetValues(all, i => [i.repo]) }), [all]);
  const inType = useMemo(() => filterQueue(base, { type, query: '', origin: 'all', unanswered: false, sort }), [base, type, sort]);
  const unansweredCount = useMemo(() => filterQueue(base, { type, query, origin, unanswered: true, sort }).length, [base, type, query, origin, sort]);
  const shown = useMemo(() => filterQueue(base, { type, query, origin, unanswered, sort }), [base, type, query, origin, unanswered, sort]);

  if (q.isLoading) return <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-11" />)}</div>;
  if (q.isError) return <EmptyState icon={Inbox} title={t('Could not load')} description={(q.error as Error).message} />;
  const github = q.data?.source.github;
  if (github && !github.configured && !all.length) return (
    <div className="rounded-xl border border-dashed">
      <EmptyState icon={Inbox} title={t('No source configured')} description={t('Connect GitHub, Jira or Linear to see tickets, bugs and tasks assigned to you.')}
        action={<Button size="sm" variant="outline" onClick={() => goTo('settings')}>{t('Open settings')}</Button>} />
    </div>
  );

  const filtering = !!query.trim() || origin !== 'all' || unanswered;
  const clear = () => { setQuery(''); setOrigin('all'); setUnanswered(false); };
  const toIncident = (i: QueueItem) => saveIncident.mutate({
    body: {
      title: i.title.slice(0, 200), severity: 'sev3', status: 'open', startedAt: i.createdAt,
      services: i.repo ? [i.repo.split('/').pop()!.slice(0, 80)] : [],
      timeline: [{ at: new Date().toISOString(), text: t('Opened from the queue: {type} {url}', { type: i.type, url: i.url }).slice(0, 1000) }],
    },
  }, { onSuccess: () => goTo('incidents') });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={type} onValueChange={setType}>
          <TabsList className="h-auto flex-wrap" aria-label={t('Item type')}>
            <TabsTrigger value="all">{t('All')}<span className="ml-1.5 tabular-nums text-muted-foreground">{base.length}</span></TabsTrigger>
            {tabs.map(x => (
              <TabsTrigger key={x.id} value={x.id}>{x.label}<span className="ml-1.5 tabular-nums text-muted-foreground">{x.count}</span></TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="ml-auto"><FilterMenu filters={filters} onChange={setFilters} options={options} /></div>
      </div>
      <ActiveFilters filters={filters} onChange={setFilters} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Filter by title, key or label')} aria-label={t('Filter by title, key or label')} className="h-8 pl-8 text-xs" />
        </div>
        {origins.length > 1 && (
          <Select value={origin} onValueChange={v => setOrigin(v as QueueOrigin)}>
            <SelectTrigger size="sm" className="h-8 w-36 text-xs" aria-label={t('Origin')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('All origins')}</SelectItem>
              {origins.map(o => <SelectItem key={o} value={o}>{t(ORIGIN_LABEL[o])}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button size="sm" variant={unanswered ? 'secondary' : 'ghost'} aria-pressed={unanswered} onClick={() => setUnanswered(!unanswered)} className="h-8 gap-1.5 text-xs">
          <MessageSquareReply className="size-3.5 text-warning" />{t('Unanswered')}<span className="tabular-nums text-muted-foreground">{unansweredCount}</span>
        </Button>
        <Select value={sort} onValueChange={v => setSort(v as QueueSort)}>
          <SelectTrigger size="sm" className="h-8 w-52 text-xs" aria-label={t('Sort by')}><SelectValue /></SelectTrigger>
          <SelectContent>{(Object.keys(SORT_LABEL) as QueueSort[]).map(s => <SelectItem key={s} value={s}>{t('Sort: {by}', { by: t(SORT_LABEL[s]) })}</SelectItem>)}</SelectContent>
        </Select>
        {filtering && <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={clear}><X /> {t('Clear')}</Button>}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{t('{n} of {total}', { n: shown.length, total: inType.length })}</span>
      </div>

      <section aria-label={t('Queue')} className="rounded-xl border bg-card shadow-xs">
        {shown.length ? (
          <ul className="divide-y" data-testid="queue-list">
            {shown.map(i => (
              <QueueRow key={i.key} item={i} onStarted={id => goTo('runs', id)}
                extra={i.kind === 'issue' ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label={t('Open incident')} disabled={saveIncident.isPending} onClick={() => toIncident(i)}><Siren /></Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('Open an incident from this item')}</TooltipContent>
                  </Tooltip>
                ) : undefined} />
            ))}
          </ul>
        ) : (
          <EmptyState icon={CheckCircle2} title={t('Nothing here')} description={t(all.length && (filtering || !isEmpty(filters) || type !== 'all') ? 'No items in this filter.' : 'No open ticket, bug, fix or task for you.')} />
        )}
        <SourceFooter source={github} />
      </section>
    </div>
  );
}
