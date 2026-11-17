// Infraestrutura em tempo real: estado dos servidores e apps, alertas disparados (com possível causa),
// deploys e a linha do tempo de eventos. Tudo só leitura, com tokens de leitura dos provedores.
import { useState } from 'react';
import { Activity, AlertTriangle, ExternalLink, Loader2, RefreshCw, Rocket, Server, Siren } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dot, EmptyState, Mono, Pill, type Tone } from '@/components/common';
import { useIncidentFromAlert, useInfra, useInfraEvents, useInfraRefresh, type InfraEvent, type InfraResourceView, type MetricPoint, type ResourceStatus } from '@/hooks/use-infra';
import { ago, dur } from '@/lib/format';
import { k, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const STATUS: Record<ResourceStatus, { label: string; tone: Tone }> = {
  ok: { label: k('ok'), tone: 'success' }, warn: { label: k('atenção'), tone: 'warning' }, down: { label: k('fora do ar'), tone: 'danger' }, unknown: { label: k('sem dados'), tone: 'neutral' },
};
const SEV_TONE = { critical: 'danger', warning: 'warning', info: 'info' } as const;
const SEV_LABEL = { critical: k('crítico'), warning: k('aviso'), info: k('info') } as const;

function Sparkline({ points, field, crit }: { points: MetricPoint[]; field: 'cpu' | 'memory'; crit: number }) {
  const vals = points.map(p => p[field]).filter((v): v is number => typeof v === 'number');
  if (vals.length < 2) return <div className="h-7" />;
  const w = 120; const h = 28;
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${((i / (vals.length - 1)) * w).toFixed(1)},${(h - (v / 100) * h).toFixed(1)}`).join(' ');
  const last = vals.at(-1)!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-7 w-full" preserveAspectRatio="none" aria-hidden>
      <line x1="0" x2={w} y1={h - (crit / 100) * h} y2={h - (crit / 100) * h} className="stroke-destructive/40" strokeDasharray="3 3" strokeWidth="1" />
      <path d={d} fill="none" strokeWidth="1.5" className={last >= crit ? 'stroke-destructive' : 'stroke-primary'} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Metric({ label, value, points, field, crit }: { label: string; value?: number; points: MetricPoint[]; field: 'cpu' | 'memory'; crit: number }) {
  if (value === undefined) return null;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between text-[11px] text-muted-foreground"><span>{label}</span><Mono className={cn(value >= crit && 'text-destructive font-semibold')}>{Math.round(value)}%</Mono></div>
      <Sparkline points={points} field={field} crit={crit} />
    </div>
  );
}

function ResourceCard({ r, cpuCrit, memCrit }: { r: InfraResourceView; cpuCrit: number; memCrit: number }) {
  const s = STATUS[r.status];
  return (
    <div className="rounded-xl border bg-card p-3 shadow-xs" data-testid="infra-resource">
      <div className="flex items-center gap-2">
        <Dot tone={s.tone} pulse={r.status === 'down'} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={r.name}>{r.name}</span>
        {r.production && <Pill tone="info">prod</Pill>}
        {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label={t('Abrir')}><ExternalLink className="size-3.5" /></a>}
      </div>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{r.provider} · {r.kind}{r.region ? ` · ${r.region}` : ''} · {r.statusText ?? t(s.label)}</p>
      {(r.metrics?.cpu !== undefined || r.metrics?.memory !== undefined) && (
        <div className="mt-2 flex gap-3">
          <Metric label="CPU" value={r.metrics?.cpu} points={r.history} field="cpu" crit={cpuCrit} />
          <Metric label={t('Memória')} value={r.metrics?.memory} points={r.history} field="memory" crit={memCrit} />
        </div>
      )}
    </div>
  );
}

function eventText(e: InfraEvent): string {
  if (e.kind === 'deploy') return e.title;
  if (e.kind === 'alert_resolved') return `${t('Resolvido')}: ${e.title}${e.durationMs ? ` (${dur(e.durationMs)})` : ''}`;
  if (e.kind === 'status') {
    const label = (x?: string) => t((STATUS[x as ResourceStatus] ?? STATUS.unknown).label);
    return `${e.resourceName ?? ''}: ${label(e.from)} → ${label(e.to)}`;
  }
  return e.title;
}
const eventTone = (e: InfraEvent): Tone => e.kind === 'alert_fired' ? SEV_TONE[e.severity ?? 'info'] : e.kind === 'alert_resolved' ? 'success'
  : e.kind === 'deploy' ? (e.deploy?.status === 'failed' ? 'danger' : 'info') : e.to === 'down' ? 'danger' : e.to === 'ok' ? 'success' : 'warning';

export function InfraView({ goToIncidents }: { goToIncidents: () => void }) {
  const q = useInfra();
  const refresh = useInfraRefresh();
  const toIncident = useIncidentFromAlert();
  const [days, setDays] = useState(1);
  const ev = useInfraEvents(days);
  const d = q.data;

  if (q.isLoading) return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>;
  if (q.isError) return <EmptyState icon={AlertTriangle} title={t('Não foi possível carregar')} description={(q.error as Error).message} />;
  if (!d?.configured) return (
    <div className="rounded-xl border border-dashed"><EmptyState icon={Server} title={t('Nenhum provedor de infra configurado')}
      description={t('Use tokens só de leitura: DIGITALOCEAN_TOKEN, HEROKU_API_KEY, AZURE_* (service principal com Monitoring Reader) ou GRAFANA_URL + GRAFANA_TOKEN (Viewer). Veja o README.')} /></div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {d.providers.map(p => (
          <Pill key={p.id} tone={p.ok === false ? 'danger' : p.ok && p.warning ? 'warning' : p.ok ? 'success' : 'neutral'} title={p.error ?? p.warning ?? (p.lastPoll ? ago(Date.parse(p.lastPoll)) : '')}>{p.label}{p.ok === false ? ` · ${t('falhou')}` : p.ok && p.warning ? ` · ${t('parcial')}` : ''}</Pill>
        ))}
        <span className="text-xs text-muted-foreground">{d.lastPoll ? t('lido {when} · a cada {n} s', { when: ago(Date.parse(d.lastPoll)), n: d.pollSec }) : t('lendo…')}</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          {refresh.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('Ler agora')}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {([['critical', t('Alertas críticos'), 'danger'], ['warning', t('Avisos'), 'warning'], ['down', t('Fora do ar'), 'danger'], ['warn', t('Com atenção'), 'warning'], ['ok', t('Saudáveis'), 'success']] as const).map(([key, label, tone]) => (
          <div key={key} className="rounded-xl border bg-card p-3 shadow-xs">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className={cn('text-2xl font-semibold tabular-nums', d.summary[key] > 0 && tone === 'danger' && 'text-destructive')}>{d.summary[key]}</p>
          </div>
        ))}
      </div>

      <section aria-label={t('Alertas disparados')} className="rounded-xl border bg-card shadow-xs">
        <header className="flex h-11 items-center gap-2 border-b px-3.5"><Siren className="size-4 text-muted-foreground" /><h2 className="text-[13px] font-semibold">{t('Alertas disparados')}</h2>{d.firing.length > 0 && <Pill tone={d.summary.critical ? 'danger' : 'warning'}>{d.firing.length}</Pill>}</header>
        {d.firing.length ? (
          <ul className="divide-y">
            {d.firing.map(f => (
              <li key={f.fingerprint} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 text-[13px]" data-testid="infra-alert">
                <Pill tone={SEV_TONE[f.severity]}>{t(SEV_LABEL[f.severity])}</Pill>
                <div className="min-w-0 flex-1">
                  <p className="truncate">{f.title}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {f.provider} · {t('há {d}', { d: dur(Date.now() - Date.parse(f.startedAt)) })}
                    {f.suspect && <> · <span className="text-warning">{t('possível causa')}: {f.suspect.title} ({ago(Date.parse(f.suspect.at))})</span></>}
                  </p>
                </div>
                {f.url && <a href={f.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label={t('Abrir')}><ExternalLink className="size-3.5" /></a>}
                {f.incidentId
                  ? <Button size="sm" variant="ghost" onClick={goToIncidents}>{t('Ver incidente')}</Button>
                  : <Button size="sm" variant="outline" onClick={() => toIncident.mutate(f.fingerprint)} disabled={toIncident.isPending}>{t('Abrir incidente')}</Button>}
              </li>
            ))}
          </ul>
        ) : <p className="px-3.5 py-6 text-xs text-muted-foreground">{t('Nenhum alerta disparado agora.')}</p>}
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {d.resources.map(r => <ResourceCard key={r.id} r={r} cpuCrit={d.rules.cpuCrit} memCrit={d.rules.memCrit} />)}
      </div>

      <section aria-label={t('Linha do tempo')} className="rounded-xl border bg-card shadow-xs">
        <header className="flex h-11 items-center gap-2 border-b px-3.5">
          <Activity className="size-4 text-muted-foreground" /><h2 className="text-[13px] font-semibold">{t('Linha do tempo')}</h2>
          <div className="ml-auto flex gap-1">{[1, 7, 30].map(n => <Button key={n} size="sm" variant={days === n ? 'secondary' : 'ghost'} onClick={() => setDays(n)}>{n === 1 ? t('24 h') : t('{n} dias', { n })}</Button>)}</div>
        </header>
        {ev.data?.items.length ? (
          <ul className="max-h-96 divide-y overflow-auto">
            {ev.data.items.map(e => (
              <li key={e._id} className="flex items-center gap-2.5 px-3.5 py-2 text-[13px]">
                <Dot tone={eventTone(e)} />{e.kind === 'deploy' ? <Rocket className="size-3.5 text-muted-foreground" /> : e.kind === 'status' ? <Server className="size-3.5 text-muted-foreground" /> : <Siren className="size-3.5 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate">{eventText(e)}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground" title={new Date(e.at).toLocaleString()}>{ago(Date.parse(e.at))}</span>
              </li>
            ))}
          </ul>
        ) : <p className="px-3.5 py-6 text-xs text-muted-foreground">{t('Sem eventos no período. Mudanças de estado, alertas e deploys aparecem aqui.')}</p>}
      </section>
      <p className="text-[11px] text-muted-foreground">{t('Regras: CPU acima de {c}% ou memória acima de {m}% por {s} min vira alerta crítico. Alerta crítico em produção abre incidente: {auto}.', { c: d.rules.cpuCrit, m: d.rules.memCrit, s: d.rules.sustainMin, auto: d.rules.autoIncident === 'critical' ? t('ligado') : t('desligado') })}</p>
    </div>
  );
}
