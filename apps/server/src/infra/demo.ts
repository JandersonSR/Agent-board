// Fictitious infrastructure for demo mode: values that change over time, a server with high CPU,
// a crashed dyno, a degraded database, Grafana and Azure alerts and deploys from the last 30 days.
import type { InfraDeploy, InfraProvider, InfraResource } from './types.js';

const MIN = 60_000;
const DAY = 86_400_000;
const wave = (now: number, period: number, phase = 0) => (Math.sin((now / period) * 2 * Math.PI + phase) + 1) / 2;

export function demoInfraProvider(startedAt = Date.now(), lang: 'pt-BR' | 'en' = 'pt-BR'): InfraProvider {
  const L = (pt: string, en: string) => (lang === 'en' ? en : pt);
  // api-prod's CPU rises 14 min before the demo opens and stays high: a sustained critical alert.
  const hotFrom = startedAt - 14 * MIN;
  const latencyFrom = new Date(startedAt - 12 * MIN).toISOString();
  return {
    id: 'demo', label: 'Demo',
    async poll(now) {
      const hot = now >= hotFrom;
      // Each resource says which provider it imitates, so the provider tabs work in the demo too.
      const resources: InfraResource[] = [
        { id: 'demo:droplet:api-prod', provider: 'digitalocean', kind: 'droplet', name: 'api-prod', status: 'ok', statusText: 'active', region: 'nyc1',
          metrics: { cpu: hot ? 92 + 5 * wave(now, 7 * MIN) : 40 + 20 * wave(now, 9 * MIN), memory: 71 + 6 * wave(now, 13 * MIN) } },
        { id: 'demo:droplet:worker-prod', provider: 'digitalocean', kind: 'droplet', name: 'worker-prod', status: 'ok', statusText: 'active', region: 'nyc1',
          metrics: { cpu: 30 + 25 * wave(now, 11 * MIN, 1), memory: 48 + 8 * wave(now, 17 * MIN, 2) } },
        { id: 'demo:app:loans-api-prod', provider: 'digitalocean', kind: 'app', name: 'loans-api-prod', status: 'ok', statusText: 'active', region: 'nyc', url: 'https://example.com',
          metrics: { cpu: 35 + 15 * wave(now, 8 * MIN, 3), memory: 62 + 5 * wave(now, 15 * MIN, 1) }, components: [{ type: 'service api', size: 'apps-s-1vcpu-1gb', count: 2 }, { type: 'worker queue', size: 'apps-s-1vcpu-0.5gb', count: 1 }] },
        { id: 'demo:heroku:payments-prod', provider: 'heroku', kind: 'app', name: 'payments-prod', status: 'warn', statusText: '1/2 up · 1 crashed', region: 'us',
          components: [{ type: 'web', size: 'Standard-2X', count: 2, up: 1 }, { type: 'worker', size: 'Standard-1X', count: 1, up: 1 }] },
        { id: 'demo:heroku:admin-staging', provider: 'heroku', kind: 'app', name: 'admin-staging', status: 'ok', statusText: '1/1 up', region: 'us',
          components: [{ type: 'web', size: 'Basic', count: 1, up: 1 }] },
        { id: 'demo:azure:loans-db', provider: 'azure', kind: 'databases', name: 'loans-db', status: 'warn', statusText: 'Degraded', region: 'brazilsouth' },
        { id: 'demo:azure:portal-prod', provider: 'azure', kind: 'sites', name: 'portal-prod', status: 'ok', statusText: 'Available', region: 'brazilsouth' },
      ];
      const deploys: InfraDeploy[] = [];
      // Production deploys over the last 30 days (2 to 3 a week) and one 25 min before the latency alert.
      for (let d = 30; d >= 1; d -= 3) {
        const at = new Date(startedAt - d * DAY + 15 * 3_600_000);
        deploys.push({ key: `demo:loans-api-prod:${d}`, provider: 'demo', resourceId: 'demo:app:loans-api-prod', resourceName: 'loans-api-prod', version: `#${120 - d}`, status: d === 12 ? 'failed' : 'succeeded', at: at.toISOString() });
        if (d % 2 === 0) deploys.push({ key: `demo:payments-prod:v${60 - d}`, provider: 'demo', resourceId: 'demo:heroku:payments-prod', resourceName: 'payments-prod', version: `v${60 - d}`, status: 'succeeded', at: new Date(at.getTime() + 3 * 3_600_000).toISOString() });
      }
      deploys.push({ key: 'demo:loans-api-prod:latest', provider: 'demo', resourceId: 'demo:app:loans-api-prod', resourceName: 'loans-api-prod', version: '#121', status: 'succeeded', at: new Date(startedAt - 37 * MIN).toISOString(), description: L('feat: arredondamento por parcela', 'feat: per-installment rounding') });
      return {
        resources,
        alerts: [
          { fingerprint: 'demo:grafana:latency', provider: 'demo', title: L('Latência p95 alta em loans-api-prod (2,4 s)', 'High p95 latency on loans-api-prod (2.4 s)'), severity: 'critical', startedAt: latencyFrom, resourceName: 'loans-api-prod' },
          { fingerprint: 'demo:azure:dtu', provider: 'demo', title: L('DTU acima de 85% em loans-db', 'DTU above 85% on loans-db'), severity: 'warning', startedAt: new Date(startedAt - 50 * MIN).toISOString(), resourceId: 'demo:azure:loans-db', resourceName: 'loans-db' },
        ],
        deploys: deploys.filter(d => Date.parse(d.at) <= now),
      };
    },
  };
}
