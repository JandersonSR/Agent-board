// Adapters with simulated API responses (no real calls).
import { describe, expect, it } from 'vitest';
import { azureProvider, azureSeverity, healthStatus, resourceFromHealthId } from './azure.js';
import { appComponents, cpuUsage, deployPhase, digitalOceanProvider, memoryUsage, peakPercent } from './digitalocean.js';
import { grafanaProvider, grafanaSeverity } from './grafana.js';
import { appStatus, dynoComponents, herokuProvider } from './heroku.js';
import type { Fetcher } from './http.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** Fetcher that answers by URL fragment and records the calls (to check headers). */
function fake(routes: Array<[RegExp, unknown]>) {
  const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
  const f: Fetcher = async (url, init) => {
    calls.push({ url, init });
    const hit = routes.find(([re]) => re.test(url));
    return hit ? json(hit[1]) : json({ message: 'not found' }, 404);
  };
  return { f, calls };
}
const series = (rows: Array<[Record<string, string>, Array<[number, string]>]>) => ({ status: 'success', data: { resultType: 'matrix', result: rows.map(([metric, values]) => ({ metric, values })) } });

describe('DigitalOcean', () => {
  it('CPU from the counter delta and memory from the available/total ratio', () => {
    const cpu = series([[{ mode: 'idle' }, [[0, '1000'], [60, '1030']]], [{ mode: 'user' }, [[0, '500'], [60, '520']]], [{ mode: 'system' }, [[0, '100'], [60, '110']]]]);
    expect(cpuUsage(cpu as never)).toBe(50); // 30 de 60 s ociosos
    expect(memoryUsage(series([[{}, [[0, '1000']]]]) as never, series([[{}, [[0, '4000']]]]) as never)).toBe(75);
    expect(cpuUsage(series([]) as never)).toBeUndefined();
    expect(deployPhase('ACTIVE')).toBe('succeeded');
    expect(deployPhase('ERROR')).toBe('failed');
    expect(deployPhase('BUILDING')).toBe('in_progress');
  });

  it('reads droplets, metrics and App Platform deploys', async () => {
    const { f, calls } = fake([
      [/\/v2\/droplets/, { droplets: [{ id: 1, name: 'api-prod', status: 'active', region: { slug: 'nyc1' } }, { id: 2, name: 'old', status: 'off' }] }],
      [/metrics\/droplet\/cpu/, series([[{ mode: 'idle' }, [[0, '0'], [60, '6']]], [{ mode: 'user' }, [[0, '0'], [60, '54']]]])],
      [/memory_available/, series([[{}, [[0, '200']]]])],
      [/memory_total/, series([[{}, [[0, '1000']]]])],
      [/\/v2\/apps\/a1\/deployments/, { deployments: [{ id: 'd1abcdef99', phase: 'ACTIVE', created_at: '2026-11-16T10:00:00Z', cause: 'commit 1a2b' }] }],
      [/\/v2\/apps/, { apps: [{ id: 'a1', spec: { name: 'web-prod' }, live_url: 'https://web', active_deployment: { id: 'd1abcdef99', phase: 'ACTIVE' } }] }],
    ]);
    const snap = await digitalOceanProvider({ token: 't0k', fetcher: f }).poll(Date.parse('2026-11-16T12:00:00Z'));
    const api = snap.resources.find(r => r.name === 'api-prod')!;
    expect(api).toMatchObject({ status: 'ok', metrics: { cpu: 90, memory: 80 } });
    expect(snap.resources.find(r => r.name === 'old')).toMatchObject({ status: 'down' });
    expect(snap.resources.find(r => r.name === 'web-prod')).toMatchObject({ kind: 'app', status: 'ok', url: 'https://web' });
    expect(snap.deploys[0]).toMatchObject({ status: 'succeeded', resourceName: 'web-prod', version: 'd1abcdef' });
    expect(calls.every(c => (c.init?.headers as Record<string, string>).Authorization === 'Bearer t0k')).toBe(true);
    expect(calls.some(c => c.url.includes('host_id=2'))).toBe(false); // off: no metrics
  });

  it('token with only app:read: droplets without scope become a warning and the apps are read', async () => {
    const f: Fetcher = async (url) => {
      if (/\/v2\/droplets/.test(url)) return json({ id: 'forbidden', message: 'You are not authorized to perform this operation' }, 403);
      if (/\/v2\/apps\/a1\/deployments/.test(url)) return json({ deployments: [] });
      if (/\/v2\/apps/.test(url)) return json({ apps: [{ id: 'a1', spec: { name: 'web-prod' }, active_deployment: { id: 'd1', phase: 'ACTIVE' } }] });
      return json({}, 404);
    };
    const snap = await digitalOceanProvider({ token: 't0k', fetcher: f }).poll(0);
    expect(snap.resources.map(r => r.name)).toEqual(['web-prod']);
    expect(snap.warnings).toEqual(['droplets: token missing scope droplet:read']);
  });

  it('no part accessible (invalid token) or a non-scope error: fails', async () => {
    const forbidden: Fetcher = async () => json({ id: 'unauthorized' }, 401);
    await expect(digitalOceanProvider({ token: 'x', fetcher: forbidden }).poll(0)).rejects.toThrow(/without permission/);
    const limited: Fetcher = async (url) => (/\/v2\/droplets/.test(url) ? json({}, 429) : json({ apps: [] }));
    await expect(digitalOceanProvider({ token: 'x', fetcher: limited }).poll(0)).rejects.toThrow(/rate limit/);
  });
  it('App Platform components and the busiest instance', () => {
    expect(appComponents({ services: [{ name: 'api', instance_size_slug: 'apps-s-1vcpu-1gb', instance_count: 2 }], workers: [{ name: 'queue' }], static_sites: [{ name: 'site' }] }))
      .toEqual([{ type: 'service api', size: 'apps-s-1vcpu-1gb', count: 2 }, { type: 'worker queue', count: 1 }, { type: 'static site', count: 1 }]);
    expect(peakPercent(series([[{ instance: 'a' }, [[0, '12.34']]], [{ instance: 'b' }, [[0, '40']]]]) as never)).toBe(40);
    expect(peakPercent(series([]) as never)).toBeUndefined();
  });

  /** Fetcher for one live app; `metrics` answers the App Platform metrics endpoints. */
  function oneApp(metrics: (url: string) => Response, deployId = 'd1') {
    const calls: string[] = [];
    const f: Fetcher = async (url) => {
      calls.push(url);
      if (/\/v2\/droplets/.test(url)) return json({ droplets: [] });
      if (/monitoring\/metrics\/apps/.test(url)) return metrics(url);
      if (/\/deployments/.test(url)) return json({ deployments: [{ id: deployId, phase: 'ACTIVE' }] });
      if (/\/v2\/apps/.test(url)) return json({ apps: [{ id: 'a1', spec: { name: 'web-prod', services: [{ name: 'web', instance_size_slug: 'basic-xxs', instance_count: 1 }] }, active_deployment: { id: deployId, phase: 'ACTIVE' } }] });
      return json({}, 404);
    };
    return { f, calls };
  }

  it('app CPU/memory with monitoring:read, read at most every 5 min; deployments only refetched on a new deploy', async () => {
    const { f, calls } = oneApp(url => json(series([[{}, [[0, url.includes('cpu') ? '35.5' : '61']]]])));
    const p = digitalOceanProvider({ token: 't', fetcher: f });
    const snap = await p.poll(0);
    expect(snap.resources[0]).toMatchObject({ metrics: { cpu: 35.5, memory: 61 }, components: [{ type: 'service web', size: 'basic-xxs', count: 1 }] });
    expect(snap.warnings).toBeUndefined();
    const metricCalls = () => calls.filter(u => u.includes('monitoring')).length;
    const deployCalls = () => calls.filter(u => u.includes('/deployments')).length;
    expect([metricCalls(), deployCalls()]).toEqual([2, 1]);
    const again = await p.poll(60_000); // 1 min later: cached values, no new calls
    expect(again.resources[0]?.metrics).toEqual({ cpu: 35.5, memory: 61 });
    expect(again.deploys).toHaveLength(1);
    expect([metricCalls(), deployCalls()]).toEqual([2, 1]);
    await p.poll(5 * 60_000);
    expect(metricCalls()).toBe(4);
  });

  it('without monitoring:read: one probe, a warning, and no per-app metric calls until the re-check', async () => {
    const { f, calls } = oneApp(() => json({ id: 'forbidden' }, 403));
    const p = digitalOceanProvider({ token: 't', fetcher: f });
    const snap = await p.poll(0);
    expect(snap.resources[0]?.metrics).toBeUndefined();
    expect(snap.warnings).toEqual(['app CPU/memory: token missing scope monitoring:read']);
    const probes = calls.filter(u => u.includes('monitoring')).length;
    await p.poll(10 * 60_000);
    expect(calls.filter(u => u.includes('monitoring')).length).toBe(probes);
    expect((await p.poll(10 * 60_000)).warnings).toEqual(['app CPU/memory: token missing scope monitoring:read']);
  });
});

describe('Heroku', () => {
  it('state from the dynos', () => {
    expect(appStatus([{ name: 'web.1', type: 'web', state: 'up' }, { name: 'web.2', type: 'web', state: 'crashed' }])).toMatchObject({ status: 'warn' });
    expect(appStatus([{ name: 'web.1', type: 'web', state: 'crashed' }])).toMatchObject({ status: 'down' });
    expect(appStatus([])).toMatchObject({ status: 'unknown' });
  });

  it('dynos by process type, web first', () => {
    expect(dynoComponents([
      { name: 'worker.1', type: 'worker', state: 'crashed', size: 'Standard-1X' },
      { name: 'web.1', type: 'web', state: 'up', size: 'Standard-2X' },
      { name: 'web.2', type: 'web', state: 'idle', size: 'Standard-2X' },
    ])).toEqual([{ type: 'web', count: 2, up: 2, size: 'Standard-2X' }, { type: 'worker', count: 1, up: 0, size: 'Standard-1X' }]);
  });

  it('v3 header, app filter and latest releases', async () => {
    const { f, calls } = fake([
      [/\/apps\/payments-prod\/dynos/, [{ name: 'web.1', type: 'web', state: 'up' }]],
      [/\/apps\/payments-prod\/releases/, [{ version: 42, status: 'succeeded', created_at: '2026-11-16T09:00:00Z', description: 'Deploy 9f8e7d' }, { version: 41, status: 'failed', created_at: '2026-11-15T09:00:00Z' }]],
      [/\/apps$/, [{ id: 'h1', name: 'payments-prod' }, { id: 'h2', name: 'outro-time' }]],
    ]);
    const snap = await herokuProvider({ token: 'hk', apps: ['payments-prod'], fetcher: f }).poll(0);
    expect(snap.resources.map(r => r.name)).toEqual(['payments-prod']);
    expect(snap.deploys.map(d => [d.version, d.status])).toEqual([['v42', 'succeeded'], ['v41', 'failed']]);
    const rel = calls.find(c => c.url.endsWith('/releases'))!;
    expect((rel.init?.headers as Record<string, string>).Accept).toBe('application/vnd.heroku+json; version=3');
    expect((rel.init?.headers as Record<string, string>).Range).toMatch(/order=desc/);
  });
});

describe('Azure', () => {
  it('health, severity and resource name', () => {
    expect(resourceFromHealthId('/subscriptions/s/resourceGroups/rg/providers/Microsoft.Sql/servers/srv/databases/loans/providers/Microsoft.ResourceHealth/availabilityStatuses/current'))
      .toEqual({ resourceId: '/subscriptions/s/resourcegroups/rg/providers/microsoft.sql/servers/srv/databases/loans', name: 'loans', kind: 'databases' });
    expect([healthStatus('Available'), healthStatus('Degraded'), healthStatus('Unavailable'), healthStatus(null)]).toEqual(['ok', 'warn', 'down', 'unknown']);
    expect([azureSeverity('Sev0'), azureSeverity('Sev2'), azureSeverity('Sev4')]).toEqual(['critical', 'warning', 'info']);
  });

  it('token by client credentials (reused) and only firing alerts', async () => {
    const { f, calls } = fake([
      [/oauth2\/v2\.0\/token/, { access_token: 'az', expires_in: 3600 }],
      [/availabilityStatuses/, { value: [{ id: '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Web/sites/api/providers/Microsoft.ResourceHealth/availabilityStatuses/current', location: 'brazilsouth', properties: { availabilityState: 'Degraded', summary: 'Degradado' } }] }],
      [/AlertsManagement\/alerts/, { value: [
        { id: '/x/alerts/a1', name: 'CPU alta api', properties: { essentials: { severity: 'Sev1', monitorCondition: 'Fired', alertState: 'New', targetResource: '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Web/sites/api', targetResourceName: 'api', startDateTime: '2026-11-16T11:50:00Z' } } },
        { id: '/x/alerts/a2', name: 'fechado', properties: { essentials: { severity: 'Sev1', monitorCondition: 'Fired', alertState: 'Closed' } } },
      ] }],
    ]);
    const p = azureProvider({ tenantId: 't', clientId: 'c', clientSecret: 's', subscriptionId: 's', fetcher: f });
    const snap = await p.poll(0);
    await p.poll(0);
    expect(calls.filter(c => c.url.includes('oauth2')).length).toBe(1);
    expect(snap.resources[0]).toMatchObject({ name: 'api', status: 'warn', kind: 'sites' });
    expect(snap.alerts).toEqual([expect.objectContaining({ title: 'CPU alta api', severity: 'critical', resourceId: snap.resources[0]!.id })]);
  });
});

describe('Grafana', () => {
  it('only active alerts, with severity from the labels', async () => {
    const { f } = fake([[/alertmanager\/grafana\/api\/v2\/alerts/, [
      { fingerprint: 'f1', labels: { alertname: 'HighLatency', severity: 'critical', service: 'loans-api' }, annotations: { summary: 'Latência p95 alta' }, startsAt: '2026-11-16T11:00:00Z', status: { state: 'active' }, generatorURL: 'https://g/alerting/1' },
      { fingerprint: 'f2', labels: { alertname: 'Silenciado' }, annotations: {}, startsAt: '2026-11-16T11:00:00Z', status: { state: 'suppressed' } },
    ]]]);
    const snap = await grafanaProvider({ url: 'https://grafana.acme.dev/', token: 'g', fetcher: f }).poll(0);
    expect(snap.alerts).toEqual([expect.objectContaining({ fingerprint: 'grafana:f1', title: 'Latência p95 alta', severity: 'critical', resourceName: 'loans-api' })]);
    expect(grafanaSeverity({ severity: 'warning' })).toBe('warning');
  });

  it('a permission error does not leak the token', async () => {
    const f: Fetcher = async () => json({ message: 'unauthorized' }, 401);
    await expect(grafanaProvider({ url: 'https://g.dev', token: 'segredo123', fetcher: f }).poll(0)).rejects.toThrow(/g\.dev: token without permission/);
    await expect(grafanaProvider({ url: 'https://g.dev', token: 'segredo123', fetcher: f }).poll(0)).rejects.not.toThrow(/segredo123/);
  });
});
