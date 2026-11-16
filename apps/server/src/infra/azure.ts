// Azure (service principal com papel de leitura, ex.: "Monitoring Reader"): saúde dos recursos (Resource Health)
// e alertas do Azure Monitor (Alerts Management). Token por client credentials, renovado antes de expirar.
import { z } from 'zod';
import { getJson, postForm, type Fetcher } from './http.js';
import type { AlertSeverity, InfraAlert, InfraProvider, InfraResource, ResourceStatus } from './types.js';

const ARM = 'https://management.azure.com';
const Token = z.object({ access_token: z.string(), expires_in: z.coerce.number() });
const Health = z.object({
  value: z.array(z.object({
    id: z.string(), location: z.string().optional(),
    properties: z.object({ availabilityState: z.string().nullable().optional(), summary: z.string().optional(), title: z.string().optional() }).passthrough(),
  })).default([]),
  nextLink: z.string().optional(),
});
const Alerts = z.object({
  value: z.array(z.object({
    id: z.string(), name: z.string().optional(),
    properties: z.object({
      essentials: z.object({
        severity: z.string().optional(), monitorCondition: z.string().optional(), alertState: z.string().optional(),
        targetResource: z.string().optional(), targetResourceName: z.string().optional(), startDateTime: z.string().optional(), alertRule: z.string().optional(),
      }).passthrough(),
    }).passthrough(),
  })).default([]),
});

/** ".../resourceGroups/rg/providers/Microsoft.Web/sites/api/providers/Microsoft.ResourceHealth/availabilityStatuses/current" → recurso. */
export function resourceFromHealthId(id: string): { resourceId: string; name: string; kind: string } {
  const base = id.replace(/\/providers\/Microsoft\.ResourceHealth\/availabilityStatuses\/current$/i, '');
  const parts = base.split('/');
  const name = parts[parts.length - 1] ?? base;
  const type = parts[parts.length - 2] ?? 'resource';
  return { resourceId: base.toLowerCase(), name, kind: type };
}

export function healthStatus(state: string | null | undefined): ResourceStatus {
  return state === 'Available' ? 'ok' : state === 'Degraded' ? 'warn' : state === 'Unavailable' ? 'down' : 'unknown';
}

/** Sev0/Sev1 = crítico, Sev2 = atenção, Sev3/Sev4 = informativo. */
export function azureSeverity(s: string | undefined): AlertSeverity {
  return s === 'Sev0' || s === 'Sev1' ? 'critical' : s === 'Sev2' ? 'warning' : 'info';
}

export function azureProvider(opts: { tenantId: string; clientId: string; clientSecret: string; subscriptionId: string; healthApiVersion?: string; fetcher?: Fetcher }): InfraProvider {
  const fetcher = opts.fetcher ?? fetch;
  let token: { value: string; until: number } | undefined;
  const auth = async () => {
    if (token && Date.now() < token.until) return token.value;
    const t = await postForm(fetcher, `https://login.microsoftonline.com/${encodeURIComponent(opts.tenantId)}/oauth2/v2.0/token`, {
      grant_type: 'client_credentials', client_id: opts.clientId, client_secret: opts.clientSecret, scope: `${ARM}/.default`,
    }, Token);
    token = { value: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 };
    return token.value;
  };
  const sub = `/subscriptions/${encodeURIComponent(opts.subscriptionId)}`;
  return {
    id: 'azure', label: 'Azure',
    async poll() {
      const h = { Authorization: `Bearer ${await auth()}` };
      const [health, alerts] = await Promise.all([
        getJson(fetcher, `${ARM}${sub}/providers/Microsoft.ResourceHealth/availabilityStatuses?api-version=${opts.healthApiVersion ?? '2026-07-01'}`, h, Health),
        getJson(fetcher, `${ARM}${sub}/providers/Microsoft.AlertsManagement/alerts?api-version=2023-07-12-preview&monitorCondition=Fired&timeRange=1d`, h, Alerts).catch(() => ({ value: [] })),
      ]);
      const resources: InfraResource[] = health.value.map(v => {
        const r = resourceFromHealthId(v.id);
        return { id: `azure:${r.resourceId}`, provider: 'azure', kind: r.kind, name: r.name, status: healthStatus(v.properties.availabilityState), statusText: v.properties.summary ?? v.properties.availabilityState ?? undefined, region: v.location };
      });
      const firing: InfraAlert[] = alerts.value
        .filter(a => a.properties.essentials.monitorCondition !== 'Resolved' && a.properties.essentials.alertState !== 'Closed')
        .map(a => {
          const e = a.properties.essentials;
          return {
            fingerprint: `azure:${a.id.split('/').pop()}`, provider: 'azure', title: a.name ?? e.alertRule?.split('/').pop() ?? 'Alerta do Azure Monitor',
            severity: azureSeverity(e.severity), startedAt: e.startDateTime ?? new Date().toISOString(),
            resourceId: e.targetResource ? `azure:${e.targetResource.toLowerCase()}` : undefined, resourceName: e.targetResourceName,
          };
        });
      return { resources, alerts: firing, deploys: [] };
    },
  };
}
