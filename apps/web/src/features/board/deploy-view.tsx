// PR and deploy tracking per issue (replaces the previous PR board).
// You give the issue (or it comes from the Project with a deploy date); the linked PRs are found
// and updated on their own. Date, team, owner and each PR's status can be adjusted here.
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
import { DEPLOY_STATUSES, isDone, STATUS_META, type DeployStatus, type TrackedIssue, type TrackedPr } from '@/lib/board-types';
import { ago, dur } from '@/lib/format';
import { k, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ActiveFilters, FilterMenu, FilterSearch, usePeople } from '@/components/filter-menu';
import { applyFilters, facetValues, isEmpty, useFilters } from '@/lib/filters';
import { issueFilterable } from './blocks';

type Filter = 'open' | 'overdue' | DeployStatus | 'all';

const DATE_SOURCE: Record<string, string> = { project: k('from the Project'), manual: k('edited on the board'), legacy: k('from the old board') };

function DeployDate({ issue }: { issue: TrackedIssue }) {
  const patch = usePatchPr();
  return (
    <div className="flex items-center gap-1">
      <Input type="date" defaultValue={issue.deployDate ?? ''} key={issue.deployDate ?? 'none'} aria-label={t('Deploy date for {title}', { title: issue.title })}
        className={cn('h-7 w-[8.5rem] text-xs tabular-nums', issue.overdue && 'border-danger/50 text-danger')}
        onBlur={e => { const v = e.target.value; if (v && v !== issue.deployDate) patch.mutate({ id: issue._id, deployDate: v }); }} />
      {issue.deployDateSource && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-[10px] text-muted-foreground">{issue.deployDateSource === 'project' ? 'Project' : t(issue.deployDateSource === 'manual' ? 'manual' : 'old')}</span>
          </TooltipTrigger>
          <TooltipContent>{t('Date {source}. Editing it here stops the Project date from overwriting it.', { source: t(DATE_SOURCE[issue.deployDateSource] ?? '') })}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function InlineText({ issue, field, placeholder }: { issue: TrackedIssue; field: 'team' | 'owner'; placeholder: string }) {
  const patch = usePatchPr();
  return (
    <Input defaultValue={issue[field] ?? ''} placeholder={t(placeholder)} aria-label={t(placeholder)}
      className="h-7 w-28 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-input focus-visible:border-input"
      onBlur={e => { const v = e.target.value.trim(); if (v !== (issue[field] ?? '')) patch.mutate({ id: issue._id, [field]: v }); }} />
  );
}

/** PR chip with a menu to set the status by hand (e.g. re-review). */
function PrChip({ issue, pr, wide = false }: { issue: TrackedIssue; pr: TrackedPr; wide?: boolean }) {
  const setStatus = useSetPrStatus();
  const meta = STATUS_META[pr.status];
  const manual = !!pr.statusOverride;
  const label = t(pr.state === 'closed' ? 'Closed' : meta.label);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('PR {pr} status: {status}', { pr: `${pr.repo ?? ''}#${pr.number ?? ''}`, status: label })}>
          <Pill tone={pr.state === 'closed' ? 'neutral' : meta.tone} className={cn(wide && 'w-40 justify-center', manual && 'ring-2')}>
            {manual ? <Hand className="size-3" /> : <GitPullRequest className="size-3" />}
            {wide ? label : (pr.base ?? pr.title)}
          </Pill>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {pr.repo?.split('/')[1]}#{pr.number} → {pr.base}<br />
          GitHub: {t(STATUS_META[pr.derivedStatus ?? pr.status].label)}{manual && ` · ${t('manual override on')}`}
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => window.open(pr.url, '_blank', 'noopener')}><ExternalLink /> {t('Open PR')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">{t('Set status')}</DropdownMenuLabel>
        {DEPLOY_STATUSES.map(s => (
          <DropdownMenuItem key={s} disabled={setStatus.isPending} onSelect={() => setStatus.mutate({ id: issue._id, url: pr.url, status: s })}>
            {pr.status === s ? <Check /> : <span className="size-4" />} {t(STATUS_META[s].label)}
          </DropdownMenuItem>
        ))}
        {manual && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setStatus.mutate({ id: issue._id, url: pr.url, status: null })}><Undo2 /> {t('Back to automatic')}</DropdownMenuItem>
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
      <Input value={issue} onChange={e => setIssue(e.target.value)} placeholder={t('Issue link, org/repo#123 or board number')} aria-label={t('Issue to track')} className="h-8 w-80 text-xs" />
      <Input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label={t('Deploy date (optional)')} className="h-8 w-36 text-xs" />
      <Button size="sm" type="submit" disabled={track.isPending || !issue.trim()}>
        {track.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('Track issue')}
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
  const q = usePrs(filter === 'all' || filter === 'merged' || filter === 'production');
  const [filters, setFilters] = useFilters('deploy');
  const people = usePeople().data;
  const raw = useMemo(() => q.data?.items ?? [], [q.data]);
  const options = useMemo(() => ({
    author: facetValues(raw, i => issueFilterable(i).authors), repo: facetValues(raw, i => issueFilterable(i).repos),
    team: facetValues(raw, i => [i.team]),
  }), [raw]);
  // Filters (person/team/repo/text) first; the tabs and counters work on the result.
  const filtered = useMemo(() => applyFilters(raw, issueFilterable, filters, people), [raw, filters, people]);
  const items = useMemo(() => {
    const all = filtered;
    if (filter === 'open') return all.filter(i => !isDone(i.status));
    if (filter === 'overdue') return all.filter(i => i.overdue);
    if (filter === 'all') return all;
    return all.filter(i => i.status === filter);
  }, [filtered, filter]);
  const counts = useMemo(() => {
    const all = filtered;
    const by = Object.fromEntries(DEPLOY_STATUSES.map(s => [s, all.filter(i => i.status === s).length])) as Record<DeployStatus, number>;
    return { open: all.filter(i => !isDone(i.status)).length, overdue: all.filter(i => i.overdue).length, by };
  }, [filtered]);
  const toggle = (id: string) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TrackForm />
        <p className="text-xs text-muted-foreground">{t('PRs linked to each issue (from any author and repo) are added and updated automatically.')}</p>
      </div>

      {q.data && q.data.projectScope === false && (
        <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-xs">
          <Info className="mt-0.5 size-4 shrink-0 text-info" />
          <p>{t('GitHub Project dates are off: the token lacks the scope')} <Mono>read:project</Mono>. {t('Run')} <Mono>gh auth refresh -s read:project</Mono> {t('and set')} <Mono>GITHUB_PROJECTS</Mono> {t('in .env. Until then, enter the date here.')}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <FilterSearch filters={filters} onChange={setFilters} className="w-72" />
        <FilterMenu filters={filters} onChange={setFilters} options={options} align="start" size="sm" />
        <ActiveFilters filters={filters} onChange={setFilters} />
        {!isEmpty(filters) && <span className="ml-auto text-xs text-muted-foreground">{t('{shown} of {total} issues', { shown: filtered.length, total: raw.length })}</span>}
      </div>

      <Tabs value={filter} onValueChange={v => setFilter(v as Filter)}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="open">{t('In progress')} <Pill className="ml-1">{counts.open}</Pill></TabsTrigger>
          <TabsTrigger value="overdue">{t('Overdue')} {counts.overdue > 0 && <Pill tone="danger" className="ml-1">{counts.overdue}</Pill>}</TabsTrigger>
          {DEPLOY_STATUSES.map(s => (
            <TabsTrigger key={s} value={s}>{t(STATUS_META[s].label)}{!isDone(s) && counts.by[s] > 0 && <Pill tone={STATUS_META[s].tone} className="ml-1">{counts.by[s]}</Pill>}</TabsTrigger>
          ))}
          <TabsTrigger value="all">{t('All')}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        {q.isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
          : items.length === 0 ? <EmptyState icon={Rocket} title={t('Nothing in this filter')} description={t('Use “Track issue” to start tracking a delivery.')} />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr className="text-left">
                    <th className="w-8" /><th className="px-2 py-2 font-medium">Issue</th><th className="px-2 font-medium">{t('Status')}</th>
                    <th className="px-2 font-medium">PRs</th><th className="px-2 font-medium">{t('Owner')}</th><th className="px-2 font-medium">{t('Team')}</th>
                    <th className="px-2 font-medium">Deploy</th><th className="px-2 text-right font-medium">{t('In status')}</th><th className="px-2 text-right font-medium">{t('Updated')}</th><th className="w-8" />
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
                            <button type="button" onClick={() => toggle(i._id)} aria-expanded={expanded} aria-label={t('Show PRs')} className="rounded p-1 hover:bg-accent">
                              <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
                            </button>
                          </td>
                          <td className="max-w-[26rem] px-2 py-2">
                            <div className="flex items-center gap-1.5">
                              {i.overdue && <AlertTriangle className="size-3.5 shrink-0 text-danger" aria-label={t('Overdue|item')} />}
                              <span className="truncate font-medium" title={i.title}>{i.title}</span>
                              {i.reference && <a href={i.reference} target="_blank" rel="noopener" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={t('Open issue')}><ExternalLink className="size-3.5" /></a>}
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              {i.reference && <Mono className="text-[10px]">#{i.reference.split('/').pop()}</Mono>}
                              {i.source === 'legacy' && ` · ${t('migrated')}`}{i.source === 'manual' && ` · ${t('added here')}`}
                              {i.issueState === 'CLOSED' && ` · ${t('issue closed')}`}
                            </span>
                          </td>
                          <td className="px-2"><Pill tone={STATUS_META[i.status].tone}>{t(STATUS_META[i.status].label)}</Pill></td>
                          <td className="px-2">
                            <div className="flex max-w-[22rem] flex-wrap gap-1">
                              {live.slice(0, 6).map(p => <PrChip key={p.url} issue={i} pr={p} />)}
                              {live.length > 6 && <button type="button" onClick={() => toggle(i._id)}><Pill>+{live.length - 6}</Pill></button>}
                              {live.length === 0 && <span className="text-muted-foreground">{t('no PR yet')}</span>}
                            </div>
                          </td>
                          <td className="px-1"><InlineText issue={i} field="owner" placeholder={k('Owner')} /></td>
                          <td className="px-1"><InlineText issue={i} field="team" placeholder={k('Team')} /></td>
                          <td className="px-1"><DeployDate issue={i} /></td>
                          <td className="px-2 text-right tabular-nums text-muted-foreground">{sinceStatus(i)}</td>
                          <td className="px-2 text-right tabular-nums text-muted-foreground">{ago(Date.parse(i.updatedAt))}</td>
                          <td className="pr-2">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button size="icon-xs" variant="ghost" aria-label={t('More actions')}><MoreHorizontal /></Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {i.reference && <DropdownMenuItem onSelect={() => window.open(i.reference, '_blank', 'noopener')}><ExternalLink /> {t('Open issue')}</DropdownMenuItem>}
                                <DropdownMenuItem onSelect={() => archive.mutate({ id: i._id, archived: true })}><Archive /> {t('Stop tracking')}</DropdownMenuItem>
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
                                    {p.statusOverride && <span className="shrink-0 text-[10px] text-muted-foreground">(GitHub: {t(STATUS_META[p.statusOverride.basis].label)})</span>}
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
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Hand className="size-3" /> {t('= status set by hand. It goes back to automatic when GitHub changes (new review, approval or merge).')} {t('In production, the card leaves automatic tracking.')}</p>
    </div>
  );
}
