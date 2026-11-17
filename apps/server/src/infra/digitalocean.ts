// DigitalOcean (read-scoped token): Droplets with CPU/memory from Monitoring, and App Platform with deploys.
// The monitoring API returns Prometheus-style series (data.result[].values = [[unix, "value"], …]).
// CPU comes as cumulative seconds per mode: usage = 1 − Δidle / Δtotal between the last two points.
// DigitalOcean alert policies do not say what is firing; threshold alerts come from the
// deck's own tracking (sustained CPU/memory), in tracker.ts.
import { z } from 'zod';
import { getJson, isScopeError, type Fetcher } from './http.js';
import { pct, type InfraComponent, type InfraDeploy, type InfraProvider, type InfraResource, type ResourceStatus } from './types.js';

const API = 'https://api.digitalocean.com';
const Series = z.object({
  data: z.object({ result: z.array(z.object({ metric: z.record(z.string(), z.string()).default({}), values: z.array(z.tuple([z.number(), z.string()])).default([]) })) }),
});
type SeriesT = z.infer<typeof Series>;

const Droplets = z.object({
  droplets: z.array(z.object({
    id: z.number(), name: z.string(), status: z.string(),
    region: z.object({ slug: z.string() }).partial().optional(), tags: z.array(z.string()).default([]),
  })),
  links: z.object({ pages: z.object({ next: z.string().optional() }).partial().optional() }).partial().optional(),
});

const Deployment = z.object({ id: z.string(), phase: z.string().optional(), cause: z.string().optional(), created_at: z.string().optional(), updated_at: z.string().optional() }).passthrough();
const Apps = z.object({
  apps: z.array(z.object({
    id: z.string(), spec: z.object({ name: z.string() }).passthrough(), live_url: z.string().optional(), region: z.object({ slug: z.string() }).partial().optional(),
    active_deployment: Deployment.optional(), in_progress_deployment: Deployment.optional(), last_deployment_active_at: z.string().optional(),
  }).passthrough()).default([]),
});
const Deployments = z.object({ deployments: z.array(Deployment).default([]) });

/** CPU usage (%) from the per-mode counters of the last interval. */
export function cpuUsage(s: SeriesT): number | undefined {
  let idle = 0; let total = 0; let ok = false;
  for (const r of s.data.result) {
    const v = r.values;
    if (v.length < 2) continue;
    const d = Number(v[v.length - 1]![1]) - Number(v[v.length - 2]![1]);
    if (!Number.isFinite(d) || d < 0) continue;
    total += d; ok = true;
    if (r.metric.mode === 'idle') idle += d;
  }
  return ok && total > 0 ? pct((1 - idle / total) * 100) : undefined;
}

const lastValue = (s: SeriesT) => {
  const v = s.data.result[0]?.values;
  const n = v?.length ? Number(v[v.length - 1]![1]) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** Memory used (%) = 1 − available / total. */
export function memoryUsage(available: SeriesT, totalS: SeriesT): number | undefined {
  const a = lastValue(available); const t = lastValue(totalS);
  return a !== undefined && t ? pct((1 - a / t) * 100) : undefined;
}

export function dropletStatus(s: string): { status: ResourceStatus; text: string } {
  return s === 'active' ? { status: 'ok', text: 'active' } : s === 'new' ? { status: 'warn', text: 'starting' } : s === 'off' ? { status: 'down', text: 'off' } : { status: 'unknown', text: s };
}

/** App Platform deploy phases → deploy state. */
export function deployPhase(phase: string | undefined): InfraDeploy['status'] {
  if (!phase) return 'in_progress';
  if (phase === 'ACTIVE' || phase === 'SUPERSEDED') return 'succeeded';
  if (phase === 'ERROR' || phase === 'CANCELED') return 'failed';
  return 'in_progress';
}

/** App Platform components (services, workers, jobs, static sites) with instance size and count, from the app spec. */
export function appComponents(spec: Record<string, unknown>): InfraComponent[] {
  const out: InfraComponent[] = [];
  const kinds = [['services', 'service'], ['workers', 'worker'], ['jobs', 'job'], ['static_sites', 'static']] as const;
  for (const [key, type] of kinds) {
    const list = Array.isArray(spec[key]) ? (spec[key] as Array<Record<string, unknown>>) : [];
    for (const c of list) {
      const size = typeof c.instance_size_slug === 'string' ? c.instance_size_slug : undefined;
      const count = typeof c.instance_count === 'number' ? c.instance_count : 1;
      out.push({ type: typeof c.name === 'string' ? `${type} ${c.name}` : type, ...(size ? { size } : {}), count });
    }
  }
  return out;
}

/** Highest last value across the series (the busiest instance), as a percentage. */
export function peakPercent(s: SeriesT): number | undefined {
  let best: number | undefined;
  for (const r of s.data.result) {
    const n = r.values.length ? Number(r.values[r.values.length - 1]![1]) : NaN;
    if (Number.isFinite(n)) best = best === undefined ? n : Math.max(best, n);
  }
  return best === undefined ? undefined : pct(best);
}

/** App CPU/memory are read at most every 5 min (rate limit: 5,000 requests/hour); without monitoring:read, re-checked every 30 min. */
const APP_METRICS_EVERY_MS = 5 * 60_000;
const APP_METRICS_RECHECK_MS = 30 * 60_000;

async function inBatches<T>(items: T[], size: number, fn: (x: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

export function digitalOceanProvider(opts: { token: string; tag?: string | undefined; fetcher?: Fetcher }): InfraProvider {
  const fetcher = opts.fetcher ?? fetch;
  const h = { Authorization: `Bearer ${opts.token}` };
  const range = (now: number) => `start=${Math.floor(now / 1000) - 600}&end=${Math.floor(now / 1000)}`;
  const metric = (name: string, id: number, now: number) =>
    getJson(fetcher, `${API}/v2/monitoring/metrics/droplet/${name}?host_id=${id}&${range(now)}`, h, Series);
  const appMetric = (name: string, id: string, now: number) =>
    getJson(fetcher, `${API}/v2/monitoring/metrics/apps/${name}?app_id=${encodeURIComponent(id)}&${range(now)}`, h, Series);

  // State across polls: app metrics (throttled) and each app's deployments (refetched only when its deploy changes).
  const appMetrics = new Map<string, InfraResource['metrics']>();
  let appMetricsAt = Number.NEGATIVE_INFINITY;
  let appMetricsScope: boolean | null = null;
  const deploysCache = new Map<string, { sig: string; list: z.infer<typeof Deployments>['deployments'] }>();

  return {
    id: 'digitalocean', label: 'DigitalOcean',
    async poll(now) {
      const resources: InfraResource[] = [];
      const deploys: InfraDeploy[] = [];
      const dropletsUrl = `${API}/v2/droplets?per_page=200${opts.tag ? `&tag_name=${encodeURIComponent(opts.tag)}` : ''}`;
      // Tokens with a custom scope (e.g. only app:read, like an App Platform watcher's) get 403 on part of the API.
      // Each part without scope becomes a warning and an empty list; it only really fails if no part can be read.
      const warnings: string[] = [];
      const scopeErrors: unknown[] = [];
      const part = <T>(p: Promise<T>, what: string, scope: string, empty: T): Promise<T> => p.catch((e: unknown) => {
        if (!isScopeError(e)) throw e;
        scopeErrors.push(e);
        warnings.push(`${what}: token missing scope ${scope}`);
        return empty;
      });
      const [d, apps] = await Promise.all([
        part(getJson(fetcher, dropletsUrl, h, Droplets), 'droplets', 'droplet:read', { droplets: [] }),
        part(getJson(fetcher, `${API}/v2/apps?per_page=100`, h, Apps), 'apps', 'app:read', { apps: [] }),
      ]);
      if (scopeErrors.length === 2) throw scopeErrors[0];

      await Promise.all(d.droplets.map(async drop => {
        const st = dropletStatus(drop.status);
        let metrics: InfraResource['metrics'];
        if (drop.status === 'active') {
          // Without the metrics agent the series come back empty: the resource shows up without numbers.
          const [cpu, avail, total] = await Promise.all([metric('cpu', drop.id, now), metric('memory_available', drop.id, now), metric('memory_total', drop.id, now)])
            .catch(() => [undefined, undefined, undefined] as const);
          metrics = { cpu: cpu ? cpuUsage(cpu) : undefined, memory: avail && total ? memoryUsage(avail, total) : undefined };
        }
        resources.push({ id: `digitalocean:droplet:${drop.id}`, provider: 'digitalocean', kind: 'droplet', name: drop.name, status: st.status, statusText: st.text, metrics, region: drop.region?.slug });
      }));

      // App CPU/memory need monitoring:read. One probe decides; a 403 turns them off (with a warning) until the next re-check.
      const live = apps.apps.filter(a => a.active_deployment);
      const due = now - appMetricsAt >= (appMetricsScope === false ? APP_METRICS_RECHECK_MS : APP_METRICS_EVERY_MS);
      if (live.length && due) {
        appMetricsAt = now;
        const read = async (app: (typeof live)[number]) => {
          const [cpu, mem] = await Promise.all([appMetric('cpu_percentage', app.id, now), appMetric('memory_percentage', app.id, now)]);
          appMetrics.set(app.id, { cpu: peakPercent(cpu), memory: peakPercent(mem) });
        };
        try {
          await read(live[0]!);
          appMetricsScope = true;
          await inBatches(live.slice(1), 5, app => read(app).catch(() => { appMetrics.delete(app.id); }));
        } catch (e) {
          // Any other failure on the probe (network, 429): keep the last values and try again next time.
          if (isScopeError(e)) { appMetricsScope = false; appMetrics.clear(); } else appMetricsAt = Number.NEGATIVE_INFINITY;
        }
      }
      if (appMetricsScope === false && live.length) warnings.push('app CPU/memory: token missing scope monitoring:read');

      await inBatches(apps.apps, 10, async app => {
        const active = app.active_deployment;
        const inProgress = app.in_progress_deployment;
        const status: ResourceStatus = active ? (deployPhase(inProgress?.phase) === 'failed' ? 'warn' : 'ok') : inProgress ? 'warn' : 'unknown';
        const id = `digitalocean:app:${app.id}`;
        const components = appComponents(app.spec);
        resources.push({
          id, provider: 'digitalocean', kind: 'app', name: app.spec.name, status,
          statusText: inProgress ? `deploy ${inProgress.phase?.toLowerCase() ?? ''}`.trim() : active ? 'active' : 'no active deploy',
          region: app.region?.slug, url: app.live_url, metrics: active ? appMetrics.get(app.id) : undefined,
          ...(components.length ? { components } : {}),
        });
        // Deployments only change with a new deploy: refetch when the active/in-progress deploy changes.
        const sig = `${active?.id ?? ''}|${inProgress?.id ?? ''}|${inProgress?.phase ?? ''}`;
        let cached = deploysCache.get(app.id);
        if (!cached || cached.sig !== sig) {
          const list = await getJson(fetcher, `${API}/v2/apps/${app.id}/deployments?per_page=10`, h, Deployments).then(r => r.deployments).catch(() => null);
          if (list) { cached = { sig, list }; deploysCache.set(app.id, cached); }
        }
        for (const dep of cached?.list ?? []) {
          deploys.push({ key: `digitalocean:${app.id}:${dep.id}`, provider: 'digitalocean', resourceId: id, resourceName: app.spec.name, version: dep.id.slice(0, 8), status: deployPhase(dep.phase), at: dep.created_at ?? dep.updated_at ?? new Date(now).toISOString(), description: dep.cause });
        }
      });
      return { resources, alerts: [], deploys, ...(warnings.length ? { warnings } : {}) };
    },
  };
}
