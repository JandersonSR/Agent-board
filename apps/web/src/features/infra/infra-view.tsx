// Real-time infrastructure: state of servers and apps, firing alerts (with a possible cause),
// deploys and the event timeline. All read-only, with the providers' read-only tokens.
// Resources can be narrowed by provider (tabs), name, state and kind, and sorted by state, name, CPU or memory.
import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, ExternalLink, Info, Loader2, RefreshCw, Rocket, Search, Server, Siren, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dot, EmptyState, Mono, Pill, type Tone } from '@/components/common';
import {
  useIncidentFromAlert, useInfra, useInfraEvents, useInfraRefresh,
  type InfraComponent, type InfraEvent, type InfraResourceView, type InfraView as InfraData, type MetricPoint, type ResourceStatus,
} from '@/hooks/use-infra';
import { ago, dur } from '@/lib/format';
import { k, t } from '@/lib/i18n';
import { usePref } from '@/lib/prefs';
import { filterResources, STATUS_ORDER, type Sort } from './infra-filter';
import { cn } from '@/lib/utils';

const STATUS: Record<ResourceStatus, { label: string; tone: Tone }> = {
  ok: { label: k('ok'), tone: 'success' }, warn: { label: k('attention'), tone: 'warning' }, down: { label: k('down'), tone: 'danger' }, unknown: { label: k('no data'), tone: 'neutral' },
};
const SEV_TONE = { critical: 'danger', warning: 'warning', info: 'info' } as const;
const SEV_LABEL = { critical: k('critical'), warning: k('warning'), info: k('info') } as const;

const SORT_LABEL: Record<Sort, string> = { status: k('State'), name: k('Name'), cpu: 'CPU', memory: k('Memory') };
/** Why a provider shows no CPU/memory (shown when none of its resources has numbers). */
const NO_METRICS_HINT: Record<string, string> = {
  heroku: k('The Heroku platform API has no CPU or memory: each app shows its dynos (type, size, how many are up).'),
  digitalocean: k('CPU and memory need a token with monitoring:read (and the metrics agent on droplets). Without it, each app shows its instance size and count.'),
};

type ProviderView = InfraData['providers'][number];
const PROVIDER_LABEL: Record<string, string> = { digitalocean: 'DigitalOcean', heroku: 'Heroku', azure: 'Azure', grafana: 'Grafana' };
interface ProviderTab { id: string; label: string; state?: ProviderView }
const providerTone = (p?: ProviderView): Tone => (!p ? 'success' : p.ok === false ? 'danger' : p.ok && p.warning ? 'warning' : p.ok ? 'success' : 'neutral');

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

function Metric({ label, value, points, field, crit }: { label: string; value?: number; points: MetricPoint[]; field?: 'cpu' | 'memory'; crit: number }) {
  if (value === undefined) return null;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between text-[11px] text-muted-foreground"><span>{label}</span><Mono className={cn(value >= crit && 'text-destructive font-semibold')}>{Math.round(value)}%</Mono></div>
      {field ? <Sparkline points={points} field={field} crit={crit} /> : <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn('h-full', value >= crit ? 'bg-destructive' : 'bg-primary')} style={{ width: `${Math.min(100, value)}%` }} /></div>}
    </div>
  );
}

/** "web 2/2 · Standard-2X" (instances up, when known) or "service api 1× · basic-xxs". */
function ComponentLine({ c }: { c: InfraComponent }) {
  const partial = c.up !== undefined && c.up < c.count;
  return (
    <li className="flex items-center gap-1.5 text-[11px]">
      <span className="min-w-0 truncate text-muted-foreground" title={c.type}>{c.type}</span>
      <Mono className={cn('shrink-0', partial && 'text-warning font-semibold', c.up === 0 && 'text-destructive')}>{c.up !== undefined ? `${c.up}/${c.count}` : `${c.count}×`}</Mono>
      {c.size && <Mono className="ml-auto shrink-0 truncate text-muted-foreground" title={c.size}>{c.size}</Mono>}
    </li>
  );
}

function ResourceCard({ r, cpuCrit, memCrit }: { r: InfraResourceView; cpuCrit: number; memCrit: number }) {
  const s = STATUS[r.status];
  const m = r.metrics;
  const hasMetrics = m?.cpu !== undefined || m?.memory !== undefined || m?.disk !== undefined;
  return (
    <div className="rounded-xl border bg-card p-3 shadow-xs" data-testid="infra-resource">
      <div className="flex items-center gap-2">
        <Dot tone={s.tone} pulse={r.status === 'down'} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={r.name}>{r.name}</span>
        {r.production && <Pill tone="info">prod</Pill>}
        {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label={t('Open')}><ExternalLink className="size-3.5" /></a>}
      </div>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{r.provider} · {r.kind}{r.region ? ` · ${r.region}` : ''} · {r.statusText ?? t(s.label)}</p>
      {hasMetrics && (
        <div className="mt-2 flex gap-3">
          <Metric label="CPU" value={m?.cpu} points={r.history} field="cpu" crit={cpuCrit} />
          <Metric label={t('Memory')} value={m?.memory} points={r.history} field="memory" crit={memCrit} />
          <Metric label={t('Disk')} value={m?.disk} points={r.history} crit={90} />
        </div>
      )}
      {!!r.components?.length && (
        <ul className="mt-2 space-y-0.5 border-t pt-2">
          {r.components.slice(0, 4).map(c => <ComponentLine key={c.type} c={c} />)}
          {r.components.length > 4 && <li className="text-[11px] text-muted-foreground">{t('+{n} more', { n: r.components.length - 4 })}</li>}
        </ul>
      )}
    </div>
  );
}

function eventText(e: InfraEvent): string {
  if (e.kind === 'deploy') return e.title;
  if (e.kind === 'alert_resolved') return `${t('Resolved')}: ${e.title}${e.durationMs ? ` (${dur(e.durationMs)})` : ''}`;
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

  const [providerPref, setProvider] = usePref<string>('infra.provider', 'all');
  const [sort, setSort] = usePref<Sort>('infra.sort', 'status');
  const [kindPref, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const [statuses, setStatuses] = useState<Set<ResourceStatus>>(new Set());

  const resources = useMemo(() => d?.resources ?? [], [d]);
  // Tabs: the configured providers plus any provider the resources come from (the demo imitates several).
  const tabs = useMemo<ProviderTab[]>(() => {
    const seen = new Set(resources.map(r => r.provider));
    const list: ProviderTab[] = (d?.providers ?? []).filter(p => p.id !== 'demo' || seen.has('demo')).map(p => ({ id: p.id, label: p.label, state: p }));
    for (const id of seen) if (!list.some(x => x.id === id)) list.push({ id, label: PROVIDER_LABEL[id] ?? id });
    return list;
  }, [d, resources]);
  // A saved provider that is no longer there falls back to "all".
  const provider = providerPref === 'all' || tabs.some(p => p.id === providerPref) ? providerPref : 'all';
  const inProvider = useMemo(() => (provider === 'all' ? resources : resources.filter(r => r.provider === provider)), [resources, provider]);
  const kinds = useMemo(() => [...new Set(inProvider.map(r => r.kind))].sort(), [inProvider]);
  const kind = kinds.includes(kindPref) ? kindPref : 'all';
  // State counts follow the name and kind filters, so each chip says how many it would show.
  const statusCounts = useMemo(() => {
    const base = filterResources(resources, { provider, query, statuses: new Set(), kind, sort: 'status' });
    return Object.fromEntries(STATUS_ORDER.map(s => [s, base.filter(r => r.status === s).length])) as Record<ResourceStatus, number>;
  }, [resources, provider, query, kind]);
  const shown = useMemo(() => filterResources(resources, { provider, query, statuses, kind, sort }), [resources, provider, query, statuses, kind, sort]);
  const events = useMemo(() => {
    if (provider === 'all') return ev.data?.items ?? [];
    const names = new Set(inProvider.map(r => r.name));
    return (ev.data?.items ?? []).filter(e => e.provider === provider || (e.resourceName && names.has(e.resourceName)));
  }, [ev.data, provider, inProvider]);
  // An alert belongs to the tab of its provider or of the resource it is about.
  const firing = useMemo(() => {
    if (provider === 'all') return d?.firing ?? [];
    const ids = new Set(inProvider.map(r => r.id)); const names = new Set(inProvider.map(r => r.name));
    return (d?.firing ?? []).filter(f => f.provider === provider || (f.resourceId && ids.has(f.resourceId)) || (f.resourceName && names.has(f.resourceName)));
  }, [d, provider, inProvider]);
  const summary = useMemo(() => ({
    ok: inProvider.filter(r => r.status === 'ok').length, warn: inProvider.filter(r => r.status === 'warn').length,
    down: inProvider.filter(r => r.status === 'down').length, critical: firing.filter(f => f.severity === 'critical').length,
    warning: firing.filter(f => f.severity === 'warning').length,
  }), [inProvider, firing]);

  if (q.isLoading) return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>;
  if (q.isError) return <EmptyState icon={AlertTriangle} title={t('Could not load')} description={(q.error as Error).message} />;
  if (!d?.configured) return (
    <div className="rounded-xl border border-dashed"><EmptyState icon={Server} title={t('No infra provider configured')}
      description={t('Use read-only tokens: DIGITALOCEAN_TOKEN, HEROKU_API_KEY, AZURE_* (service principal with Monitoring Reader) or GRAFANA_URL + GRAFANA_TOKEN (Viewer). See the README.')} /></div>
  );

  const toggleStatus = (s: ResourceStatus) => setStatuses(prev => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  const filtering = !!query.trim() || statuses.size > 0 || kind !== 'all';
  const clear = () => { setQuery(''); setStatuses(new Set()); setKind('all'); };
  const current = tabs.find(p => p.id === provider)?.state;
  const noMetrics = provider !== 'all' && inProvider.length > 0 && !inProvider.some(r => r.metrics?.cpu !== undefined || r.metrics?.memory !== undefined);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={provider} onValueChange={setProvider}>
          <TabsList>
            <TabsTrigger value="all">{t('All')}<span className="ml-1.5 tabular-nums text-muted-foreground">{resources.length}</span></TabsTrigger>
            {tabs.map(({ id, label, state: p }) => (
              <TabsTrigger key={id} value={id} title={p ? p.error ?? p.warning ?? (p.lastPoll ? ago(Date.parse(p.lastPoll)) : '') : ''}>
                <Dot tone={providerTone(p)} className="mr-1.5" />{label}
                <span className="ml-1.5 tabular-nums text-muted-foreground">{resources.filter(r => r.provider === id).length}</span>
                {p?.ok === false ? <span className="ml-1 text-destructive">· {t('failed')}</span> : p?.ok && p.warning ? <span className="ml-1 text-warning">· {t('partial')}</span> : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="text-xs text-muted-foreground">{d.lastPoll ? t('read {when} · every {n} s', { when: ago(Date.parse(d.lastPoll)), n: d.pollSec }) : t('reading…')}</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          {refresh.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('Read now')}
        </Button>
      </div>
      {current && (current.error || current.warning) && (
        <p className={cn('flex items-center gap-1.5 text-xs', current.error ? 'text-destructive' : 'text-warning')}><AlertTriangle className="size-3.5" />{current.error ?? current.warning}</p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {([['critical', t('Critical alerts'), 'danger'], ['warning', t('Warnings'), 'warning'], ['down', t('Down'), 'danger'], ['warn', t('Needs attention'), 'warning'], ['ok', t('Healthy'), 'success']] as const).map(([key, label, tone]) => (
          <div key={key} className="rounded-xl border bg-card p-3 shadow-xs">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className={cn('text-2xl font-semibold tabular-nums', summary[key] > 0 && tone === 'danger' && 'text-destructive')}>{summary[key]}</p>
          </div>
        ))}
      </div>

      <section aria-label={t('Firing alerts')} className="rounded-xl border bg-card shadow-xs">
        <header className="flex h-11 items-center gap-2 border-b px-3.5"><Siren className="size-4 text-muted-foreground" /><h2 className="text-[13px] font-semibold">{t('Firing alerts')}</h2>{firing.length > 0 && <Pill tone={summary.critical ? 'danger' : 'warning'}>{firing.length}</Pill>}</header>
        {firing.length ? (
          <ul className="divide-y">
            {firing.map(f => (
              <li key={f.fingerprint} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 text-[13px]" data-testid="infra-alert">
                <Pill tone={SEV_TONE[f.severity]}>{t(SEV_LABEL[f.severity])}</Pill>
                <div className="min-w-0 flex-1">
                  <p className="truncate">{f.title}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {f.provider} · {t('for {d}', { d: dur(Date.now() - Date.parse(f.startedAt)) })}
                    {f.suspect && <> · <span className="text-warning">{t('possible cause')}: {f.suspect.title} ({ago(Date.parse(f.suspect.at))})</span></>}
                  </p>
                </div>
                {f.url && <a href={f.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label={t('Open')}><ExternalLink className="size-3.5" /></a>}
                {f.incidentId
                  ? <Button size="sm" variant="ghost" onClick={goToIncidents}>{t('View incident')}</Button>
                  : <Button size="sm" variant="outline" onClick={() => toIncident.mutate(f.fingerprint)} disabled={toIncident.isPending}>{t('Open incident')}</Button>}
              </li>
            ))}
          </ul>
        ) : <p className="px-3.5 py-6 text-xs text-muted-foreground">{t('No alerts firing right now.')}</p>}
      </section>

      <section aria-label={t('Resources')} className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Filter by name')} aria-label={t('Filter by name')} className="h-8 pl-8 text-xs" />
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t('State')}>
            {STATUS_ORDER.map(s => (
              <Button key={s} size="sm" variant={statuses.has(s) ? 'secondary' : 'ghost'} aria-pressed={statuses.has(s)} onClick={() => toggleStatus(s)} className="h-8 gap-1.5 text-xs">
                <Dot tone={STATUS[s].tone} />{t(STATUS[s].label)}<span className="tabular-nums text-muted-foreground">{statusCounts[s]}</span>
              </Button>
            ))}
          </div>
          {kinds.length > 1 && (
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger size="sm" className="h-8 w-36 text-xs" aria-label={t('Kind')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('All kinds')}</SelectItem>
                {kinds.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={sort} onValueChange={v => setSort(v as Sort)}>
            <SelectTrigger size="sm" className="h-8 w-40 text-xs" aria-label={t('Sort by')}><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(SORT_LABEL) as Sort[]).map(s => <SelectItem key={s} value={s}>{t('Sort: {by}', { by: s === 'cpu' ? 'CPU' : t(SORT_LABEL[s]) })}</SelectItem>)}</SelectContent>
          </Select>
          {filtering && <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={clear}><X /> {t('Clear')}</Button>}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">{t('{n} of {total}', { n: shown.length, total: inProvider.length })}</span>
        </div>
        {noMetrics && NO_METRICS_HINT[provider] && <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Info className="size-3.5" />{t(NO_METRICS_HINT[provider])}</p>}
        {shown.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {shown.map(r => <ResourceCard key={r.id} r={r} cpuCrit={d.rules.cpuCrit} memCrit={d.rules.memCrit} />)}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed px-3.5 py-6 text-center text-xs text-muted-foreground">{inProvider.length ? t('No resources match the filters.') : t('No resources read from this provider yet.')}</p>
        )}
      </section>

      <section aria-label={t('Timeline')} className="rounded-xl border bg-card shadow-xs">
        <header className="flex h-11 items-center gap-2 border-b px-3.5">
          <Activity className="size-4 text-muted-foreground" /><h2 className="text-[13px] font-semibold">{t('Timeline')}</h2>
          <div className="ml-auto flex gap-1">{[1, 7, 30].map(n => <Button key={n} size="sm" variant={days === n ? 'secondary' : 'ghost'} onClick={() => setDays(n)}>{n === 1 ? t('24 h') : t('{n} days', { n })}</Button>)}</div>
        </header>
        {events.length ? (
          <ul className="max-h-96 divide-y overflow-auto">
            {events.map(e => (
              <li key={e._id} className="flex items-center gap-2.5 px-3.5 py-2 text-[13px]">
                <Dot tone={eventTone(e)} />{e.kind === 'deploy' ? <Rocket className="size-3.5 text-muted-foreground" /> : e.kind === 'status' ? <Server className="size-3.5 text-muted-foreground" /> : <Siren className="size-3.5 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate">{eventText(e)}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground" title={new Date(e.at).toLocaleString()}>{ago(Date.parse(e.at))}</span>
              </li>
            ))}
          </ul>
        ) : <p className="px-3.5 py-6 text-xs text-muted-foreground">{t('No events in this period. Status changes, alerts and deploys show up here.')}</p>}
      </section>
      <p className="text-[11px] text-muted-foreground">{t('Rules: CPU above {c}% or memory above {m}% for {s} min becomes a critical alert. Critical alert in production opens an incident: {auto}.', { c: d.rules.cpuCrit, m: d.rules.memCrit, s: d.rules.sustainMin, auto: d.rules.autoIncident === 'critical' ? t('on') : t('off') })}</p>
    </div>
  );
}
