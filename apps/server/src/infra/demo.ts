// Infraestrutura fictícia para o modo demonstração: valores que variam com o tempo, um servidor com CPU alta,
// um dyno travado, um banco degradado, alertas do Grafana e do Azure e deploys dos últimos 30 dias.
import type { InfraDeploy, InfraProvider, InfraResource } from './types.js';

const MIN = 60_000;
const DAY = 86_400_000;
const wave = (now: number, period: number, phase = 0) => (Math.sin((now / period) * 2 * Math.PI + phase) + 1) / 2;

export function demoInfraProvider(startedAt = Date.now(), lang: 'pt-BR' | 'en' = 'pt-BR'): InfraProvider {
  const L = (pt: string, en: string) => (lang === 'en' ? en : pt);
  // A CPU do api-prod sobe 14 min antes de o demo abrir e fica alta: alerta crítico sustentado.
  const hotFrom = startedAt - 14 * MIN;
  const latencyFrom = new Date(startedAt - 12 * MIN).toISOString();
  return {
    id: 'demo', label: 'Demo',
    async poll(now) {
      const hot = now >= hotFrom;
      const resources: InfraResource[] = [
        { id: 'demo:droplet:api-prod', provider: 'demo', kind: 'droplet', name: 'api-prod', status: 'ok', statusText: 'active', region: 'nyc1',
          metrics: { cpu: hot ? 92 + 5 * wave(now, 7 * MIN) : 40 + 20 * wave(now, 9 * MIN), memory: 71 + 6 * wave(now, 13 * MIN) } },
        { id: 'demo:droplet:worker-prod', provider: 'demo', kind: 'droplet', name: 'worker-prod', status: 'ok', statusText: 'active', region: 'nyc1',
          metrics: { cpu: 30 + 25 * wave(now, 11 * MIN, 1), memory: 48 + 8 * wave(now, 17 * MIN, 2) } },
        { id: 'demo:app:loans-api-prod', provider: 'demo', kind: 'app', name: 'loans-api-prod', status: 'ok', statusText: 'active', region: 'nyc', url: 'https://example.com' },
        { id: 'demo:heroku:payments-prod', provider: 'demo', kind: 'app', name: 'payments-prod', status: 'warn', statusText: '1/2 up · 1 crashed', region: 'us' },
        { id: 'demo:heroku:admin-staging', provider: 'demo', kind: 'app', name: 'admin-staging', status: 'ok', statusText: '1/1 up', region: 'us' },
        { id: 'demo:azure:loans-db', provider: 'demo', kind: 'databases', name: 'loans-db', status: 'warn', statusText: 'Degraded', region: 'brazilsouth' },
        { id: 'demo:azure:portal-prod', provider: 'demo', kind: 'sites', name: 'portal-prod', status: 'ok', statusText: 'Available', region: 'brazilsouth' },
      ];
      const deploys: InfraDeploy[] = [];
      // Deploys de produção nos últimos 30 dias (2 a 3 por semana) e um 25 min antes do alerta de latência.
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
