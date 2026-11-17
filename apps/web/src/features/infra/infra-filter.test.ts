import { describe, expect, it } from 'vitest';
import type { InfraResourceView } from '@/hooks/use-infra';
import { filterResources } from './infra-filter';

const r = (provider: string, name: string, status: InfraResourceView['status'], kind = 'app', cpu?: number, memory?: number): InfraResourceView =>
  ({ id: `${provider}:${name}`, provider, kind, name, status, production: false, history: [], ...(cpu !== undefined || memory !== undefined ? { metrics: { cpu, memory } } : {}) });

const all = [
  r('heroku', 'payments-prod', 'down'),
  r('heroku', 'payments-staging', 'ok'),
  r('digitalocean', 'web-prod', 'ok', 'app', 20, 70),
  r('digitalocean', 'api-prod', 'warn', 'app', 90, 30),
  r('digitalocean', 'db-box', 'ok', 'droplet'),
];
const base = { provider: 'all', query: '', statuses: new Set<InfraResourceView['status']>(), kind: 'all', sort: 'status' as const };
const names = (xs: InfraResourceView[]) => xs.map(x => x.name);

describe('filterResources', () => {
  it('by provider, name (case-insensitive) and kind', () => {
    expect(names(filterResources(all, { ...base, provider: 'heroku' }))).toEqual(['payments-prod', 'payments-staging']);
    expect(names(filterResources(all, { ...base, query: ' PROD ' }))).toEqual(['payments-prod', 'web-prod', 'api-prod']);
    expect(names(filterResources(all, { ...base, provider: 'digitalocean', kind: 'droplet' }))).toEqual(['db-box']);
  });

  it('several states at once; none selected shows all', () => {
    expect(names(filterResources(all, { ...base, statuses: new Set(['down', 'warn'] as const) }))).toEqual(['payments-prod', 'api-prod']);
    expect(filterResources(all, base)).toHaveLength(5);
  });

  it('sorts by CPU or memory (highest first, no data last) and by name; status keeps the server order', () => {
    expect(names(filterResources(all, { ...base, provider: 'digitalocean', sort: 'cpu' }))).toEqual(['api-prod', 'web-prod', 'db-box']);
    expect(names(filterResources(all, { ...base, provider: 'digitalocean', sort: 'memory' }))).toEqual(['web-prod', 'api-prod', 'db-box']);
    expect(names(filterResources(all, { ...base, provider: 'heroku', sort: 'name' }))).toEqual(['payments-prod', 'payments-staging']);
    expect(names(filterResources(all, base))).toEqual(names(all));
  });

  it('does not change the input array', () => {
    const copy = [...all];
    filterResources(all, { ...base, sort: 'name' });
    expect(all).toEqual(copy);
  });
});
