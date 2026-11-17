// Heroku Platform API v3 (token with "read" scope): dyno state and releases (deploys) of each app.
// The platform API has no CPU/memory; a crashed dyno is already the most useful signal. Fine-grained metrics are left for
// a log drain in the future.
import { z } from 'zod';
import { getJson, type Fetcher } from './http.js';
import type { InfraDeploy, InfraProvider, InfraResource, ResourceStatus } from './types.js';

const API = 'https://api.heroku.com';
const Apps = z.array(z.object({ id: z.string(), name: z.string(), web_url: z.string().nullable().optional(), region: z.object({ name: z.string() }).partial().nullable().optional() }));
const Dynos = z.array(z.object({ name: z.string(), type: z.string(), state: z.string(), updated_at: z.string().optional() }));
const Releases = z.array(z.object({ version: z.number(), status: z.string(), created_at: z.string(), description: z.string().nullable().optional(), current: z.boolean().optional() }));

/** App state from its dynos: crashed = down; restarting = warning. */
export function appStatus(dynos: z.infer<typeof Dynos>): { status: ResourceStatus; text: string } {
  if (!dynos.length) return { status: 'unknown', text: 'sem dynos' };
  const crashed = dynos.filter(d => d.state === 'crashed').length;
  const up = dynos.filter(d => d.state === 'up' || d.state === 'idle').length;
  const starting = dynos.filter(d => d.state === 'starting').length;
  const text = `${up}/${dynos.length} up${crashed ? ` · ${crashed} crashed` : ''}${starting ? ` · ${starting} starting` : ''}`;
  if (crashed && !up) return { status: 'down', text };
  if (crashed || starting) return { status: 'warn', text };
  return { status: 'ok', text };
}

export function releaseStatus(s: string): InfraDeploy['status'] {
  return s === 'succeeded' ? 'succeeded' : s === 'failed' ? 'failed' : 'in_progress';
}

export function herokuProvider(opts: { token: string; apps: string[]; fetcher?: Fetcher }): InfraProvider {
  const fetcher = opts.fetcher ?? fetch;
  const h = { Authorization: `Bearer ${opts.token}`, Accept: 'application/vnd.heroku+json; version=3' };
  return {
    id: 'heroku', label: 'Heroku',
    async poll() {
      const all = await getJson(fetcher, `${API}/apps`, h, Apps);
      const wanted = opts.apps.length ? all.filter(a => opts.apps.includes(a.name)) : all;
      const resources: InfraResource[] = [];
      const deploys: InfraDeploy[] = [];
      await Promise.all(wanted.slice(0, 50).map(async app => {
        const [dynos, releases] = await Promise.all([
          getJson(fetcher, `${API}/apps/${encodeURIComponent(app.name)}/dynos`, h, Dynos),
          getJson(fetcher, `${API}/apps/${encodeURIComponent(app.name)}/releases`, { ...h, Range: 'version ..; order=desc, max=10;' }, Releases).catch(() => []),
        ]);
        const st = appStatus(dynos);
        const id = `heroku:app:${app.id}`;
        resources.push({ id, provider: 'heroku', kind: 'app', name: app.name, status: st.status, statusText: st.text, region: app.region?.name, url: app.web_url ?? undefined });
        for (const r of releases) {
          deploys.push({ key: `heroku:${app.id}:v${r.version}`, provider: 'heroku', resourceId: id, resourceName: app.name, version: `v${r.version}`, status: releaseStatus(r.status), at: r.created_at, description: r.description ?? undefined });
        }
      }));
      return { resources, alerts: [], deploys };
    },
  };
}
