// DORA: deploy frequency, lead time, change failure rate and time to restore.
import { Info, Rocket } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, Mono, Pill } from '@/components/common';
import { useDora } from '@/hooks/use-staff';
import { fmtDay } from '@/lib/format';
import { locale, t } from '@/lib/i18n';
import { usePref } from '@/lib/prefs';
import { durDays, durOrDash, pct, Tile } from './shared';

const RANGES = ['30', '90', '180'] as const;
type Range = (typeof RANGES)[number];
const num = (x: number) => x.toLocaleString(locale(), { maximumFractionDigits: x >= 10 ? 0 : 1 });

export function DoraView() {
  const [range, setRange] = usePref<Range>('metrics.dora.range', '90');
  const q = useDora(range);
  const d = q.data;
  const maxWeek = Math.max(1, ...(d?.weeks.map(w => w.deploys) ?? [1]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('Period')}</span>
        <Tabs value={range} onValueChange={v => setRange(v as Range)}>
          <TabsList>{RANGES.map(r => <TabsTrigger key={r} value={r}>{t('{n} days', { n: r })}</TabsTrigger>)}</TabsList>
        </Tabs>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground lg:ml-auto">
          <Info className="size-3.5" /> {t('Delivery = merged issue with a deploy date. Failure = hotfix, rollback or revert, or the cause of an incident.')}
        </p>
      </div>

      {q.isLoading && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>}
      {q.error && <p className="text-sm text-danger">{(q.error as Error).message}</p>}
      {d && !d.configured && (
        <div className="rounded-xl border border-dashed"><EmptyState icon={Rocket} title={t('MongoDB not configured')} description={t('DORA metrics come from deploy dates in PRs and deploys and from the incident log.')} /></div>
      )}
      {d?.configured && d.deploys.items === 0 && !d.deploys.real && d.recovery.resolved === 0 && (
        <div className="rounded-xl border border-dashed"><EmptyState icon={Rocket} title={t('No deliveries in this period yet')} description={t('Merged issues with a deploy date show up here. Log incidents in Incidents to measure recovery.')} /></div>
      )}
      {d?.configured && (d.deploys.items > 0 || !!d.deploys.real || d.recovery.resolved > 0) && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={t('Deploy frequency')} value={t('{n}/week', { n: num(d.deploys.daysPerWeek) })}
              sub={d.deploys.real ? t('{n} real production deploys on {days} days · {items} deliveries', { n: d.deploys.real.count, days: d.deploys.real.days, items: d.deploys.items }) : t('{days} deploy days · {items} deliveries', { days: d.deploys.days, items: d.deploys.items })} />
            <Tile label={t('Lead time (median)')} value={durDays(d.leadTime.medianMs)}
              sub={d.leadTime.p90Ms !== null ? t('90% within {d}', { d: durDays(d.leadTime.p90Ms) }) : undefined} />
            <Tile label={t('Change failure rate')} value={pct(d.changeFailure.rate)}
              sub={t('{n} failures: {fix} fixes, {inc} with an incident', { n: d.changeFailure.failures, fix: d.changeFailure.fixes, inc: d.changeFailure.incidents })} />
            <Tile label={t('Time to restore (median)')} value={durOrDash(d.recovery.medianMs)}
              sub={t('{n} incidents resolved · {open} open', { n: d.recovery.resolved, open: d.recovery.open })} />
          </div>

          <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
            <h3 className="border-b px-4 py-3 text-sm font-semibold">{t('Per week')}</h3>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground"><tr className="border-b text-left">
                <th className="px-4 py-2 font-medium">{t('Week of')}</th><th className="w-1/3 px-4 font-medium">{t('Deliveries')}</th>
                <th className="px-4 text-right font-medium">{t('Deploy days')}</th><th className="px-4 text-right font-medium">{t('Failures')}</th>
                <th className="px-4 text-right font-medium">{t('Lead time')}</th>
              </tr></thead>
              <tbody>
                {d.weeks.map(w => (
                  <tr key={w.week} className="border-b last:border-0">
                    <td className="px-4 py-2 tabular-nums">{fmtDay(w.week)}</td>
                    <td className="px-4">
                      <div className="flex items-center gap-2">
                        <div className="flex h-2 overflow-hidden rounded-sm" style={{ width: `${(w.deploys / maxWeek) * 100}%`, minWidth: w.deploys ? 4 : 0 }}>
                          <div className="h-full bg-series-1" style={{ flex: w.deploys - w.failures }} />
                          <div className="h-full bg-danger" style={{ flex: w.failures }} />
                        </div>
                        <span className="tabular-nums">{w.deploys}</span>
                      </div>
                    </td>
                    <td className="px-4 text-right tabular-nums">{w.deployDays}</td>
                    <td className="px-4 text-right tabular-nums">{w.failures || '—'}</td>
                    <td className="px-4 text-right tabular-nums">{durDays(w.medianLeadMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {d.failures.length > 0 && (
            <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
              <h3 className="border-b px-4 py-3 text-sm font-semibold">{t('Failed deliveries')}</h3>
              <ul className="divide-y text-xs">
                {d.failures.map(f => (
                  <li key={f.key} className="flex items-center gap-2 px-4 py-2">
                    <span className="w-14 shrink-0 tabular-nums text-muted-foreground">{fmtDay(f.deployDate)}</span>
                    <a href={f.key.startsWith('http') ? f.key : undefined} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{f.title}</a>
                    {f.reasons.map(r => <Pill key={r} tone={r === 'incident' ? 'danger' : 'warning'}>{t(r === 'incident' ? 'caused an incident' : 'fix')}</Pill>)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-[11px] text-muted-foreground">
            {t('Lead time: from the first PR the board saw to noon on the deploy date. Fix regex:')} <Mono className="text-[11px]">{d.failureRe}</Mono> (DORA_FAILURE_RE)
          </p>
        </>
      )}
    </div>
  );
}
