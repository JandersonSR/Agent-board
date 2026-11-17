// Grafana (service account with the Viewer role): alerts firing in Grafana's built-in Alertmanager.
// GET /api/alertmanager/grafana/api/v2/alerts returns only the active ones; whatever leaves the list becomes "resolved".
import { z } from 'zod';
import { getJson, type Fetcher } from './http.js';
import type { AlertSeverity, InfraAlert, InfraProvider } from './types.js';

const Alerts = z.array(z.object({
  fingerprint: z.string(),
  labels: z.record(z.string(), z.string()).default({}),
  annotations: z.record(z.string(), z.string()).default({}),
  startsAt: z.string(),
  status: z.object({ state: z.string() }).partial().optional(),
  generatorURL: z.string().optional(),
}).passthrough());

export function grafanaSeverity(labels: Record<string, string>): AlertSeverity {
  const s = (labels.severity ?? labels.priority ?? '').toLowerCase();
  return /crit|p1|sev1|high|page/.test(s) ? 'critical' : /info|low|p4|p5/.test(s) ? 'info' : 'warning';
}

export function parseGrafanaAlerts(raw: z.infer<typeof Alerts>): InfraAlert[] {
  return raw
    .filter(a => (a.status?.state ?? 'active') === 'active')
    .map(a => {
      const resource = a.labels.instance ?? a.labels.service ?? a.labels.app ?? a.labels.job;
      return {
        fingerprint: `grafana:${a.fingerprint}`, provider: 'grafana',
        title: a.annotations.summary ?? a.labels.alertname ?? 'Alerta do Grafana',
        severity: grafanaSeverity(a.labels), startedAt: a.startsAt, url: a.generatorURL,
        resourceName: resource,
      };
    });
}

export function grafanaProvider(opts: { url: string; token: string; fetcher?: Fetcher }): InfraProvider {
  const fetcher = opts.fetcher ?? fetch;
  const base = opts.url.replace(/\/+$/, '');
  return {
    id: 'grafana', label: 'Grafana',
    async poll() {
      const raw = await getJson(fetcher, `${base}/api/alertmanager/grafana/api/v2/alerts?active=true&silenced=false&inhibited=false`, { Authorization: `Bearer ${opts.token}` }, Alerts);
      return { resources: [], alerts: parseGrafanaAlerts(raw), deploys: [] };
    },
  };
}
