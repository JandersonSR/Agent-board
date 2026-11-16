// Métricas do v2: tempo trabalhando x esperando você, custo e por tarefa.
// Gráfico: barras empilhadas (2 séries, paleta validada), gap de 2px entre segmentos,
// topo arredondado de 4px, tooltip por barra e alternância para tabela.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/common';
import { api } from '@/lib/api';
import { ago, dur, fmtCost, fmtDay, fmtTok, plural } from '@/lib/format';
import { k, t } from '@/lib/i18n';
import { usePref } from '@/lib/prefs';
import type { Metrics } from '@/lib/types';
import { QualityView } from './quality-view';
import { Tile } from './shared';
import { TeamMetricsView } from './team-metrics-view';

const RANGES = ['1', '7', '30', '90'] as const;
type Range = (typeof RANGES)[number];


function StackedBars({ perDay }: { perDay: Metrics['perDay'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 220, L = 36, B = 22, T = 10;
  const hours = (ms: number) => ms / 3_600_000;
  const maxH = Math.max(1, ...perDay.map(d => hours(d.working + d.waiting)));
  const step = maxH <= 4 ? 1 : maxH <= 12 ? 2 : maxH <= 24 ? 4 : Math.ceil(maxH / 6);
  const top = Math.ceil(maxH / step) * step;
  const y = (h: number) => T + (H - T - B) * (1 - h / top);
  const n = perDay.length;
  const gx = (W - L) / n;
  const bw = Math.min(36, gx * 0.6);

  // Segmento com topo arredondado (só o segmento de cima de cada barra).
  const seg = (x: number, y0: number, y1: number, round: boolean, fill: string) => {
    const h = y0 - y1;
    if (h <= 0.5) return null;
    if (!round) return <rect x={x} y={y1} width={bw} height={h} fill={fill} />;
    const r = Math.min(4, h, bw / 2);
    return <path d={`M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + bw - r} Q${x + bw},${y1} ${x + bw},${y1 + r} V${y0} Z`} fill={fill} />;
  };

  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const hd = hover !== null ? perDay[hover] : undefined;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full" role="img" aria-label={t('Horas por dia: trabalhando e esperando você')} preserveAspectRatio="none">
        {ticks.map(v => (
          <g key={v}>
            <line x1={L} x2={W} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">{v}h</text>
          </g>
        ))}
        {perDay.map((d, i) => {
          const x = L + gx * i + (gx - bw) / 2;
          const w = hours(d.working), a = hours(d.waiting);
          const yW = y(w), yA = y(w + a);
          const gap = w > 0 && a > 0 ? 2 : 0;
          const showLabel = n <= 14 || i % Math.ceil(n / 10) === 0;
          return (
            <g key={d.date} opacity={hover === null || hover === i ? 1 : 0.45}>
              {seg(x, y(0), yW, a <= 0, 'var(--series-1)')}
              {seg(x, yW - gap, yA, true, 'var(--series-2)')}
              {showLabel && <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">{fmtDay(d.date)}</text>}
              <rect x={L + gx * i} y={T} width={gx} height={H - T - B} fill="transparent"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            </g>
          );
        })}
      </svg>
      {hd && hover !== null && (
        <div className="pointer-events-none absolute top-2 rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `clamp(0px, calc(${((L + gx * hover + gx / 2) / W) * 100}% - 60px), calc(100% - 140px))` }}>
          <p className="font-medium">{fmtDay(hd.date, true)}</p>
          <p className="flex items-center gap-1.5 text-muted-foreground"><span className="size-2 rounded-sm bg-series-1" /> {t('Trabalhando')}: <span className="text-foreground tabular-nums">{dur(hd.working)}</span></p>
          <p className="flex items-center gap-1.5 text-muted-foreground"><span className="size-2 rounded-sm bg-series-2" /> {t('Esperando você')}: <span className="text-foreground tabular-nums">{dur(hd.waiting)}</span></p>
        </div>
      )}
    </div>
  );
}

type MetricsTab = 'agents' | 'team' | 'quality';

/** Métricas em três visões: agentes (hooks), fluxo de entrega do time e qualidade da review por IA. */
export function MetricsView() {
  const [tab, setTab] = usePref<MetricsTab>('metrics.tab', 'agents');
  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={v => setTab(v as MetricsTab)}>
        <TabsList>
          <TabsTrigger value="agents">{t('Agentes')}</TabsTrigger>
          <TabsTrigger value="team">{t('Time')}</TabsTrigger>
          <TabsTrigger value="quality">{t('Qualidade da IA')}</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'agents' && <AgentMetrics />}
      {tab === 'team' && <TeamMetricsView />}
      {tab === 'quality' && <QualityView />}
    </div>
  );
}

function AgentMetrics() {
  const [range, setRange] = usePref<Range>('metrics.range', '7');
  const [asTable, setAsTable] = useState(false);
  const q = useQuery({
    queryKey: ['metrics', range],
    queryFn: () => api.get<Metrics>(`/api/metrics?days=${range}`),
    refetchInterval: 60_000,
  });
  const m = q.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('Período')}</span>
        <Tabs value={range} onValueChange={v => setRange(v as Range)}>
          <TabsList>{RANGES.map(r => <TabsTrigger key={r} value={r}>{plural(Number(r), 'dia', 'dias')}</TabsTrigger>)}</TabsList>
        </Tabs>
      </div>

      {q.isLoading && <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>}
      {q.error && <p className="text-sm text-danger">{(q.error as Error).message}</p>}
      {m && !m.sessions && (
        <div className="rounded-xl border border-dashed"><EmptyState icon={BarChart3} title={t('Ainda sem dados')} description={t('As métricas contam a partir das sessões registradas pelos hooks.')} /></div>
      )}
      {m && m.sessions > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label={t('Agentes esperando você')} value={dur(m.waitingOnYou)} sub={t('{asking} pedindo · {review} prontos p/ revisão', { asking: dur(m.needsYou), review: dur(m.review) })} />
            <Tile label={t('Tempo trabalhando')} value={dur(m.working)} />
            <Tile label={t('Resposta mediana a pedidos')} value={dur(m.medianResponse)} sub={plural(m.asks, 'pedido', 'pedidos')} />
            <Tile label={t('Custo estimado')} value={fmtCost(m.cost)} sub={`${fmtTok(m.tokens)} tokens`} />
            <Tile label={t('Sessões')} value={String(m.sessions)} />
          </div>

          <section className="rounded-xl border bg-card p-4 shadow-xs">
            <div className="mb-3 flex items-center gap-3">
              <h3 className="text-sm font-semibold">{t('Por dia')}</h3>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-series-1" /> {t('Trabalhando')}</span>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-series-2" /> {t('Esperando você')}</span>
              </div>
              <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setAsTable(v => !v)} aria-pressed={asTable}>
                {asTable ? <BarChart3 /> : <Table2 />} {t(asTable ? 'Ver gráfico' : 'Ver tabela')}
              </Button>
            </div>
            {asTable ? (
              <table className="w-full text-xs">
                <thead className="text-muted-foreground"><tr className="border-b text-left"><th className="py-1.5 font-medium">{t('Dia')}</th><th className="text-right font-medium">{t('Trabalhando')}</th><th className="text-right font-medium">{t('Esperando você')}</th></tr></thead>
                <tbody>{m.perDay.map(d => (
                  <tr key={d.date} className="border-b last:border-0"><td className="py-1.5">{fmtDay(d.date, true)}</td><td className="text-right tabular-nums">{dur(d.working)}</td><td className="text-right tabular-nums">{dur(d.waiting)}</td></tr>
                ))}</tbody>
              </table>
            ) : <StackedBars perDay={m.perDay} />}
          </section>

          <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
            <h3 className="border-b px-4 py-3 text-sm font-semibold">{t('Por tarefa')}</h3>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b text-left">
                    {[k('Tarefa'), k('Sessões'), k('Trabalhando'), k('Esperando você'), k('Custo'), k('Tokens'), k('Última atividade')].map((h, i) => (
                      <th key={h} className={`px-4 py-2 font-medium ${i ? 'text-right' : ''}`}>{t(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {m.tasks.map(r => (
                    <tr key={r.key} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="px-4 py-2 font-medium">{r.key}{r.project && r.project !== r.key && <span className="ml-1.5 font-normal text-muted-foreground">{r.project}</span>}</td>
                      <td className="px-4 text-right tabular-nums">{r.sessions}</td>
                      <td className="px-4 text-right tabular-nums">{dur(r.working)}</td>
                      <td className="px-4 text-right tabular-nums">{dur(r.waiting)}</td>
                      <td className="px-4 text-right tabular-nums">{fmtCost(r.cost)}</td>
                      <td className="px-4 text-right tabular-nums">{fmtTok(r.tokens)}</td>
                      <td className="px-4 text-right tabular-nums text-muted-foreground">{ago(r.lastTs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
