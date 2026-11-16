// Fluxo de entrega do time a partir do histórico dos PRs acompanhados (PRs e deploy).
// Mede o processo, não as pessoas: serve para achar gargalos e comparar antes e depois de uma mudança.
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
  const heads = [k('Nome'), k('Mergeados'), k('Abertos'), k('Até o merge'), k('Espera 1º review'), k('Mudanças pedidas'), k('Tamanho')];
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
        <span className="text-xs text-muted-foreground">{t('Período')}</span>
        <Tabs value={range} onValueChange={v => setRange(v as Range)}>
          <TabsList>{RANGES.map(r => <TabsTrigger key={r} value={r}>{t('{n} dias', { n: r })}</TabsTrigger>)}</TabsList>
        </Tabs>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground lg:ml-auto">
          <Info className="size-3.5" /> {t('Mede o fluxo, não as pessoas: use para achar gargalos do processo, não para ranquear ninguém.')}
        </p>
      </div>

      {q.isLoading && <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>}
      {q.error && <p className="text-sm text-danger">{(q.error as Error).message}</p>}
      {m && !m.configured && (
        <div className="rounded-xl border border-dashed"><EmptyState icon={Users} title={t('MongoDB não configurado')} description={t('As métricas do time vêm do acompanhamento de PRs, que fica no MongoDB do painel.')} /></div>
      )}
      {m?.configured && m.summary.merged + m.summary.open === 0 && (
        <div className="rounded-xl border border-dashed"><EmptyState icon={Users} title={t('Ainda sem dados')} description={t('Acompanhe issues em PRs e deploy. O histórico de status de cada PR alimenta estas métricas.')} /></div>
      )}
      {m?.configured && m.summary.merged + m.summary.open > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label={t('PRs mergeados')} value={String(m.summary.merged)} sub={t('{n} abertos agora', { n: m.summary.open })} />
            <Tile label={t('Tempo até o merge (mediana)')} value={durOrDash(m.summary.medianCycleMs)} />
            <Tile label={t('Espera pelo 1º review (mediana)')} value={durOrDash(m.summary.medianFirstReviewWaitMs)}
              sub={m.waitingOverOneDay ? t('{n} esperando há mais de 1 dia', { n: m.waitingOverOneDay }) : undefined} />
            <Tile label={t('Com mudanças pedidas')} value={pct(m.summary.changesRequestedRate)} sub={t('dos PRs mergeados')} />
            <Tile label={t('Tamanho mediano (linhas)')} value={m.summary.medianSize === null ? '—' : String(m.summary.medianSize)}
              sub={t('{pct} acima de 400 linhas', { pct: pct(m.summary.largeRate) })} />
          </div>

          <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
            <h3 className="border-b px-4 py-3 text-sm font-semibold">{t('Por semana')}</h3>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground"><tr className="border-b text-left">
                <th className="px-4 py-2 font-medium">{t('Semana de')}</th><th className="w-1/3 px-4 font-medium">{t('Mergeados')}</th>
                <th className="px-4 text-right font-medium">{t('Até o merge')}</th><th className="px-4 text-right font-medium">{t('Espera 1º review')}</th>
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

          <GroupTable title={k('Por time')} rows={m.byTeam} />
          <GroupTable title={k('Por pessoa')} rows={m.byOwner} />
          <p className="text-[11px] text-muted-foreground">{t('O início de cada PR é quando o painel o viu pela primeira vez, não a criação no GitHub.')}</p>
        </>
      )}
    </div>
  );
}
