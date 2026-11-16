// DORA: frequência de deploy, tempo de entrega, taxa de falha de mudança e tempo de recuperação.
import { Info, Rocket } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, Mono, Pill } from '@/components/common';
import { useDora } from '@/hooks/use-staff';
import { fmtDay } from '@/lib/format';
import { t } from '@/lib/i18n';
import { usePref } from '@/lib/prefs';
import { durDays, durOrDash, pct, Tile } from './shared';

const RANGES = ['30', '90', '180'] as const;
type Range = (typeof RANGES)[number];
const num = (x: number) => (x >= 10 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, ''));

export function DoraView() {
  const [range, setRange] = usePref<Range>('metrics.dora.range', '90');
  const q = useDora(range);
  const d = q.data;
  const maxWeek = Math.max(1, ...(d?.weeks.map(w => w.deploys) ?? [1]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('Período')}</span>
        <Tabs value={range} onValueChange={v => setRange(v as Range)}>
          <TabsList>{RANGES.map(r => <TabsTrigger key={r} value={r}>{t('{n} dias', { n: r })}</TabsTrigger>)}</TabsList>
        </Tabs>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground lg:ml-auto">
          <Info className="size-3.5" /> {t('Entrega = issue mergeada com data de deploy. Falha = hotfix, rollback ou revert, ou causa de um incidente.')}
        </p>
      </div>

      {q.isLoading && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>}
      {q.error && <p className="text-sm text-danger">{(q.error as Error).message}</p>}
      {d && !d.configured && (
        <div className="rounded-xl border border-dashed"><EmptyState icon={Rocket} title={t('MongoDB não configurado')} description={t('As métricas DORA vêm das datas de deploy em PRs e deploy e do registro de incidentes.')} /></div>
      )}
      {d?.configured && d.deploys.items === 0 && d.recovery.resolved === 0 && (
        <div className="rounded-xl border border-dashed"><EmptyState icon={Rocket} title={t('Ainda sem entregas no período')} description={t('Issues mergeadas com data de deploy aparecem aqui. Registre incidentes em Incidentes para medir a recuperação.')} /></div>
      )}
      {d?.configured && (d.deploys.items > 0 || d.recovery.resolved > 0) && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={t('Frequência de deploy')} value={t('{n}/semana', { n: num(d.deploys.daysPerWeek) })}
              sub={t('{days} dias de deploy · {items} entregas', { days: d.deploys.days, items: d.deploys.items })} />
            <Tile label={t('Tempo de entrega (mediana)')} value={durDays(d.leadTime.medianMs)}
              sub={d.leadTime.p90Ms !== null ? t('90% em até {d}', { d: durDays(d.leadTime.p90Ms) }) : undefined} />
            <Tile label={t('Taxa de falha de mudança')} value={pct(d.changeFailure.rate)}
              sub={t('{n} falhas: {fix} correções, {inc} com incidente', { n: d.changeFailure.failures, fix: d.changeFailure.fixes, inc: d.changeFailure.incidents })} />
            <Tile label={t('Tempo de recuperação (mediana)')} value={durOrDash(d.recovery.medianMs)}
              sub={t('{n} incidentes resolvidos · {open} abertos', { n: d.recovery.resolved, open: d.recovery.open })} />
          </div>

          <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
            <h3 className="border-b px-4 py-3 text-sm font-semibold">{t('Por semana')}</h3>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground"><tr className="border-b text-left">
                <th className="px-4 py-2 font-medium">{t('Semana de')}</th><th className="w-1/3 px-4 font-medium">{t('Entregas')}</th>
                <th className="px-4 text-right font-medium">{t('Dias de deploy')}</th><th className="px-4 text-right font-medium">{t('Falhas')}</th>
                <th className="px-4 text-right font-medium">{t('Tempo de entrega')}</th>
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
              <h3 className="border-b px-4 py-3 text-sm font-semibold">{t('Entregas com falha')}</h3>
              <ul className="divide-y text-xs">
                {d.failures.map(f => (
                  <li key={f.key} className="flex items-center gap-2 px-4 py-2">
                    <span className="w-14 shrink-0 tabular-nums text-muted-foreground">{fmtDay(f.deployDate)}</span>
                    <a href={f.key.startsWith('http') ? f.key : undefined} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{f.title}</a>
                    {f.reasons.map(r => <Pill key={r} tone={r === 'incident' ? 'danger' : 'warning'}>{t(r === 'incident' ? 'causou incidente' : 'correção')}</Pill>)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-[11px] text-muted-foreground">
            {t('Tempo de entrega: do primeiro PR visto pelo painel até o meio-dia da data de deploy. Regex de correção:')} <Mono className="text-[11px]">{d.failureRe}</Mono> (DORA_FAILURE_RE)
          </p>
        </>
      )}
    </div>
  );
}
