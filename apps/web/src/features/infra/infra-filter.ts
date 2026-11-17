// Infra resource filters: provider, name, states and kind, then the chosen order.
import type { InfraResourceView, ResourceStatus } from '@/hooks/use-infra';

export type Sort = 'status' | 'name' | 'cpu' | 'memory';
/** Worst first: the order of the state chips. */
export const STATUS_ORDER: ResourceStatus[] = ['down', 'warn', 'unknown', 'ok'];

const metricValue = (r: InfraResourceView, sort: 'cpu' | 'memory') => r.metrics?.[sort] ?? -1;

/** Resources of the chosen provider that match the name, states and kind, in the chosen order. */
export function filterResources(
  resources: InfraResourceView[],
  f: { provider: string; query: string; statuses: ReadonlySet<ResourceStatus>; kind: string; sort: Sort },
): InfraResourceView[] {
  const q = f.query.trim().toLowerCase();
  const out = resources.filter(r => (f.provider === 'all' || r.provider === f.provider)
    && (!q || r.name.toLowerCase().includes(q))
    && (!f.statuses.size || f.statuses.has(r.status))
    && (f.kind === 'all' || r.kind === f.kind));
  if (f.sort === 'name') return out.sort((a, b) => a.name.localeCompare(b.name));
  if (f.sort === 'cpu' || f.sort === 'memory') { const s = f.sort; return out.sort((a, b) => metricValue(b, s) - metricValue(a, s) || a.name.localeCompare(b.name)); }
  return out; // the server already sends them by state (down first), production first, then name
}
