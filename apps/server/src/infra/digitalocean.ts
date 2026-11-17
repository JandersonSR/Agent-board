// DigitalOcean (token com escopo de leitura): Droplets com CPU/memória do Monitoring e App Platform com deploys.
// A API de monitoramento devolve séries no formato Prometheus (data.result[].values = [[unix, "valor"], …]).
// CPU vem como segundos acumulados por modo: uso = 1 − Δidle / Δtotal entre os dois últimos pontos.
// As políticas de alerta do DigitalOcean não informam o que está disparando; os alertas de limite saem do
// acompanhamento do painel (CPU/memória sustentadas), em tracker.ts.
import { z } from 'zod';
import { getJson, type Fetcher } from './http.js';
import { pct, type InfraDeploy, type InfraProvider, type InfraResource, type ResourceStatus } from './types.js';

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

/** Uso de CPU (%) a partir dos contadores por modo do último intervalo. */
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

/** Memória usada (%) = 1 − disponível / total. */
export function memoryUsage(available: SeriesT, totalS: SeriesT): number | undefined {
  const a = lastValue(available); const t = lastValue(totalS);
  return a !== undefined && t ? pct((1 - a / t) * 100) : undefined;
}

export function dropletStatus(s: string): { status: ResourceStatus; text: string } {
  return s === 'active' ? { status: 'ok', text: 'active' } : s === 'new' ? { status: 'warn', text: 'starting' } : s === 'off' ? { status: 'down', text: 'off' } : { status: 'unknown', text: s };
}

/** Fases de deploy do App Platform → estado do deploy. */
export function deployPhase(phase: string | undefined): InfraDeploy['status'] {
  if (!phase) return 'in_progress';
  if (phase === 'ACTIVE' || phase === 'SUPERSEDED') return 'succeeded';
  if (phase === 'ERROR' || phase === 'CANCELED') return 'failed';
  return 'in_progress';
}

export function digitalOceanProvider(opts: { token: string; tag?: string | undefined; fetcher?: Fetcher }): InfraProvider {
  const fetcher = opts.fetcher ?? fetch;
  const h = { Authorization: `Bearer ${opts.token}` };
  const metric = (name: string, id: number, now: number) =>
    getJson(fetcher, `${API}/v2/monitoring/metrics/droplet/${name}?host_id=${id}&start=${Math.floor(now / 1000) - 600}&end=${Math.floor(now / 1000)}`, h, Series);

  return {
    id: 'digitalocean', label: 'DigitalOcean',
    async poll(now) {
      const resources: InfraResource[] = [];
      const deploys: InfraDeploy[] = [];
      const dropletsUrl = `${API}/v2/droplets?per_page=200${opts.tag ? `&tag_name=${encodeURIComponent(opts.tag)}` : ''}`;
      const [d, apps] = await Promise.all([getJson(fetcher, dropletsUrl, h, Droplets), getJson(fetcher, `${API}/v2/apps?per_page=100`, h, Apps)]);

      await Promise.all(d.droplets.map(async drop => {
        const st = dropletStatus(drop.status);
        let metrics: InfraResource['metrics'];
        if (drop.status === 'active') {
          // Sem o agente de métricas as séries vêm vazias: o recurso aparece sem números.
          const [cpu, avail, total] = await Promise.all([metric('cpu', drop.id, now), metric('memory_available', drop.id, now), metric('memory_total', drop.id, now)])
            .catch(() => [undefined, undefined, undefined] as const);
          metrics = { cpu: cpu ? cpuUsage(cpu) : undefined, memory: avail && total ? memoryUsage(avail, total) : undefined };
        }
        resources.push({ id: `digitalocean:droplet:${drop.id}`, provider: 'digitalocean', kind: 'droplet', name: drop.name, status: st.status, statusText: st.text, metrics, region: drop.region?.slug });
      }));

      await Promise.all(apps.apps.map(async app => {
        const active = app.active_deployment;
        const inProgress = app.in_progress_deployment;
        const status: ResourceStatus = active ? (deployPhase(inProgress?.phase) === 'failed' ? 'warn' : 'ok') : inProgress ? 'warn' : 'unknown';
        const id = `digitalocean:app:${app.id}`;
        resources.push({ id, provider: 'digitalocean', kind: 'app', name: app.spec.name, status, statusText: inProgress ? `deploy ${inProgress.phase?.toLowerCase() ?? ''}`.trim() : active ? 'active' : 'sem deploy ativo', region: app.region?.slug, url: app.live_url });
        const list = await getJson(fetcher, `${API}/v2/apps/${app.id}/deployments?per_page=10`, h, Deployments).catch(() => ({ deployments: [] }));
        for (const dep of list.deployments) {
          deploys.push({ key: `digitalocean:${app.id}:${dep.id}`, provider: 'digitalocean', resourceId: id, resourceName: app.spec.name, version: dep.id.slice(0, 8), status: deployPhase(dep.phase), at: dep.created_at ?? dep.updated_at ?? new Date(now).toISOString(), description: dep.cause });
        }
      }));
      return { resources, alerts: [], deploys };
    },
  };
}
