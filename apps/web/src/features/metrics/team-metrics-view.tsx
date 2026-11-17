// Team delivery flow from the history of the tracked PRs (PRs and deploys).
// Measures the process, not people: it is for finding bottlenecks and comparing before and after a change.
import { useQuery } from '@tanstack/react-query';
import { Info, Users } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/common';
import { api } from '@/lib/api';
import { fmtDay } from '@/lib/format';
import { k, t } from '@/lib/i18n';
import { usePref } from '@/lib/prefs';
import { cn } from '@/lib/utils';
import { durOrDash, pct, Tile } from './shared';

interface FlowSummary {
  merged: number; open: number; medianCycleMs: number | null; medianFirstReviewWaitMs: number | null;
  changesRequestedRate: number | null; medianSize: number | null; largeRate: number | null;
}
interface TeamMetrics {
  configured: boolean; days: number; summary: FlowSummary; waitingOverOneDay: number;
  weeks: Array<{ week: string; merged: number; medianCycleMs: number | null; medianFirstReviewWaitMs: number | null }>;
  byOwner: Array<FlowSummary & { key: string }>; byTeam: Array<FlowSummary & { key: string }>;
}

const RANGES = ['7', '30', '90'] as const;
type Range = (typeof RANGES)[number];


function GroupTable({ title, rows }: { title: string; rows: Array<FlowSummary & { key: string }> }) {
  if (!rows.length) return null;
  const heads = [k('Name'), k('Merged|count'), k('Open|count'), k('To merge'), k('First review wait'), k('Changes requested'), k('Size')];
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <h3 className="border-b px-4 py-3 text-sm font-semibold">{t(title)}</h3>
      <div className="overflow-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground"><tr className="border-b text-left">
            {heads.map((h, i) => <th key={h} className={cn('px-4 py-2 font-medium', i && 'text-right')}>{t(h)}</th>)}
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-b last:border-0 hover:bg-muted/50">
                <td className="px-4 py-2 font-medium">{r.key}</td>
                <td className="px-4 text-right tabular-nums">{r.merged}</td>
                <td className="px-4 text-right tabular-nums">{r.open}</td>
                <td className="px-4 text-right tabular-nums">{durOrDash(r.medianCycleMs)}</td>
                <td className="px-4 text-right tabular-nums">{durOrDash(r.medianFirstReviewWaitMs)}</td>
                <td className="px-4 text-right tabular-nums">{pct(r.changesRequestedRate)}</td>
                <td className="px-4 text-right tabular-nums">{r.medianSize ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function TeamMetricsView() {
  const [range, setRange] = usePref<Range>('metrics.team.range', '30');
  const q = useQuery({ queryKey: ['team-metrics', range], queryFn: () => api.get<TeamMetrics>(`/api/team-metrics?days=${range}`), refetchInterval: 5 * 60_000 });
  const m = q.data;
  const maxWeek = Math.max(1, ...(m?.weeks.map(w => w.merged) ?? [1]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('Period')}</span>
        <Tabs value={range} onValueChange={v => setRange(v as Range)}>
          <TabsList>{RANGES.map(r => <TabsTrigger key={r} value={r}>{t('{n} days', { n: r })}</TabsTrigger>)}</TabsList>
        </Tabs>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground lg:ml-auto">
          <Info className="size-3.5" /> {t('It measures the flow, not people: use it to find process bottlenecks, never to rank anyone.')}
        </p>
      </div>

      {q.isLoading && <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>}
      {q.error && <p className="text-sm text-danger">{(q.error as Error).message}</p>}
      {m && !m.configured && (
        <div className="rounded-xl border border-dashed"><EmptyState icon={Users} title={t('MongoDB not configured')} description={t('Team metrics come from PR tracking, stored in the board\'s MongoDB.')} /></div>
      )}
      {m?.configured && m.summary.merged + m.summary.open === 0 && (
        <div className="rounded-xl border border-dashed"><EmptyState icon={Users} title={t('No data yet')} description={t('Track issues in PRs and deploys. Each PR\'s status history feeds these metrics.')} /></div>
      )}
      {m?.configured && m.summary.merged + m.summary.open > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label={t('Merged PRs')} value={String(m.summary.merged)} sub={t('{n} open now', { n: m.summary.open })} />
            <Tile label={t('Time to merge (median)')} value={durOrDash(m.summary.medianCycleMs)} />
            <Tile label={t('Wait for first review (median)')} value={durOrDash(m.summary.medianFirstReviewWaitMs)}
              sub={m.waitingOverOneDay ? t('{n} waiting over 1 day', { n: m.waitingOverOneDay }) : undefined} />
            <Tile label={t('With changes requested')} value={pct(m.summary.changesRequestedRate)} sub={t('of merged PRs')} />
            <Tile label={t('Median size (lines)')} value={m.summary.medianSize === null ? '—' : String(m.summary.medianSize)}
              sub={t('{pct} over 400 lines', { pct: pct(m.summary.largeRate) })} />
          </div>

          <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
            <h3 className="border-b px-4 py-3 text-sm font-semibold">{t('Per week')}</h3>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground"><tr className="border-b text-left">
                <th className="px-4 py-2 font-medium">{t('Week of')}</th><th className="w-1/3 px-4 font-medium">{t('Merged|count')}</th>
                <th className="px-4 text-right font-medium">{t('To merge')}</th><th className="px-4 text-right font-medium">{t('First review wait')}</th>
              </tr></thead>
              <tbody>
                {m.weeks.map(w => (
                  <tr key={w.week} className="border-b last:border-0">
                    <td className="px-4 py-2 tabular-nums">{fmtDay(w.week)}</td>
                    <td className="px-4">
                      <div className="flex items-center gap-2">
                        <div className="h-2 rounded-sm bg-series-1" style={{ width: `${(w.merged / maxWeek) * 100}%`, minWidth: w.merged ? 4 : 0 }} />
                        <span className="tabular-nums">{w.merged}</span>
                      </div>
                    </td>
                    <td className="px-4 text-right tabular-nums">{durOrDash(w.medianCycleMs)}</td>
                    <td className="px-4 text-right tabular-nums">{durOrDash(w.medianFirstReviewWaitMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <GroupTable title={k('By team')} rows={m.byTeam} />
          <GroupTable title={k('By person')} rows={m.byOwner} />
          <p className="text-[11px] text-muted-foreground">{t('Each PR starts when the board first saw it, not when it was created on GitHub.')}</p>
        </>
      )}
    </div>
  );
}
