// AI review quality: how many findings the Tech Lead keeps (precision),
// by prompt version, severity and repository. The basis for changing skill, model or context with a number.
import { Sparkles } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, Mono, Pill } from '@/components/common';
import { useQuality, type QualityBucket } from '@/hooks/use-runs';
import { fmtCost } from '@/lib/format';
import { k, t } from '@/lib/i18n';
import { usePref } from '@/lib/prefs';
import { cn } from '@/lib/utils';
import { EvalsSection } from './evals-section';
import { durOrDash, pct, Tile } from './shared';

const RANGES = ['7', '30', '90'] as const;
type Range = (typeof RANGES)[number];

const precisionTone = (p: number | null) => (p === null ? 'neutral' : p >= 0.7 ? 'success' : p >= 0.4 ? 'warning' : 'danger');

function BucketTable({ title, rows, mono = false }: { title: string; rows: QualityBucket[]; mono?: boolean }) {
  if (!rows.length) return null;
  const heads = [k('Group'), k('Runs'), k('Findings'), k('Judged'), k('Kept'), k('Precision'), k('Cost per kept finding'), k('Median duration')];
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
                <td className="px-4 py-2 font-medium">{mono ? <Mono className="text-[11px]">{r.key}</Mono> : r.key}</td>
                <td className="px-4 text-right tabular-nums">{r.runs}</td>
                <td className="px-4 text-right tabular-nums">{r.findings}</td>
                <td className="px-4 text-right tabular-nums">{r.judged}</td>
                <td className="px-4 text-right tabular-nums">{r.accepted}</td>
                <td className="px-4 text-right"><Pill tone={precisionTone(r.precision)}>{pct(r.precision)}</Pill></td>
                <td className="px-4 text-right tabular-nums">{r.costPerAccepted === null ? '—' : fmtCost(r.costPerAccepted)}</td>
                <td className="px-4 text-right tabular-nums">{durOrDash(r.medianDurationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function QualityView() {
  const [range, setRange] = usePref<Range>('metrics.quality.range', '30');
  const q = useQuality(range);
  const m = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('Period')}</span>
        <Tabs value={range} onValueChange={v => setRange(v as Range)}>
          <TabsList>{RANGES.map(r => <TabsTrigger key={r} value={r}>{t('{n} days', { n: r })}</TabsTrigger>)}</TabsList>
        </Tabs>
        <p className="text-[11px] text-muted-foreground lg:ml-auto">{t('Precision = kept findings ÷ judged findings in Runs.')}</p>
      </div>
      {q.isLoading && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>}
      {q.error && <p className="text-sm text-danger">{(q.error as Error).message}</p>}
      {m && m.overall.runs === 0 && (
        <div className="rounded-xl border border-dashed"><EmptyState icon={Sparkles} title={t('No AI reviews in this period')}
          description={t('Run reviews with ✨ in Pending reviews and mark each finding as kept or discarded in Runs.')} /></div>
      )}
      {m && m.overall.runs > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={t('Precision')} value={pct(m.overall.precision)} sub={t('{a} kept of {j} judged', { a: m.overall.accepted, j: m.overall.judged })} />
            <Tile label={t('Judging coverage')} value={pct(m.overall.coverage)} sub={t('{j} of {f} findings', { j: m.overall.judged, f: m.overall.findings })} />
            <Tile label={t('Reviews')} value={String(m.overall.runs)} sub={t('median duration {d}', { d: durOrDash(m.overall.medianDurationMs) })} />
            <Tile label={t('Cost per kept finding')} value={m.overall.costPerAccepted === null ? '—' : fmtCost(m.overall.costPerAccepted)} sub={t('total {c}', { c: fmtCost(m.overall.costUsd) })} />
          </div>
          {m.overall.coverage !== null && m.overall.coverage < 0.5 && (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">{t('Fewer than half of the findings were judged: precision is not reliable yet.')}</p>
          )}
          <BucketTable title={k('By prompt version')} rows={m.byVersion} mono />
          <BucketTable title={k('By severity')} rows={m.bySeverity} />
          <BucketTable title={k('By repository')} rows={m.byRepo} mono />
        </>
      )}
      <EvalsSection />
    </div>
  );
}
