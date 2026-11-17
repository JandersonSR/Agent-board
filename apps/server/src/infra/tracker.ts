// Tracking across reads: turns infrastructure "snapshots" into events.
// - provider alerts + sustained threshold alerts (CPU/memory) + resource down;
// - fired / resolved (whatever leaves the list resolves; a provider that failed the read resolves nothing);
// - resource state changes and new deploys.
// Pure function: the service keeps the state and persists the events.
import type { AlertSeverity, InfraAlert, InfraDeploy, InfraProviderId, InfraResource, InfraSnapshot, ResourceStatus } from './types.js';

export interface TrackerRules { cpuWarn: number; cpuCrit: number; memCrit: number; sustainMin: number; lang?: 'pt-BR' | 'en' | undefined }
const L = (rules: TrackerRules, pt: string, en: string) => (rules.lang === 'en' ? en : pt);

export type InfraEventKind = 'alert_fired' | 'alert_resolved' | 'status' | 'deploy';
export interface InfraEvent {
  key: string; kind: InfraEventKind; provider: InfraProviderId; at: string;
  title: string; severity?: AlertSeverity | undefined; fingerprint?: string | undefined;
  resourceId?: string | undefined; resourceName?: string | undefined;
  from?: ResourceStatus | undefined; to?: ResourceStatus | undefined;
  deploy?: Pick<InfraDeploy, 'version' | 'status' | 'description' | 'url'> | undefined;
  durationMs?: number | undefined;
}

export interface FiringAlert extends InfraAlert { firstSeenAt: string; synthetic: boolean }

export interface TrackerState {
  firing: Map<string, FiringAlert>;
  /** "resource:metric" → since when it has been above the threshold. */
  above: Map<string, { since: number; level: AlertSeverity }>;
  statuses: Map<string, ResourceStatus>;
  deploys: Set<string>;
  initialized: boolean;
}

export const newTrackerState = (): TrackerState => ({ firing: new Map(), above: new Map(), statuses: new Map(), deploys: new Set(), initialized: false });

const iso = (t: number) => new Date(t).toISOString();

function thresholdAlerts(r: InfraResource, state: TrackerState, rules: TrackerRules, now: number): InfraAlert[] {
  const out: InfraAlert[] = [];
  const checks: Array<[string, number | undefined, number, number]> = [
    ['cpu', r.metrics?.cpu, rules.cpuWarn, rules.cpuCrit],
    ['memory', r.metrics?.memory, rules.memCrit - 5, rules.memCrit],
  ];
  for (const [metric, value, warn, crit] of checks) {
    const key = `${r.id}:${metric}`;
    if (value === undefined || value < warn) { state.above.delete(key); continue; }
    const level: AlertSeverity = value >= crit ? 'critical' : 'warning';
    const prev = state.above.get(key);
    // Going up a level restarts the count for the new level but keeps the start for "since".
    const since = prev ? prev.since : now;
    state.above.set(key, { since, level });
    if (now - since >= rules.sustainMin * 60_000) {
      const label = metric === 'cpu' ? 'CPU' : L(rules, 'Memória', 'Memory');
      out.push({
        fingerprint: `limit:${key}`, provider: r.provider, resourceId: r.id, resourceName: r.name, severity: level,
        title: L(rules, `${label} alta em ${r.name}: ${Math.round(value)}%`, `High ${metric === 'cpu' ? 'CPU' : 'memory'} on ${r.name}: ${Math.round(value)}%`), startedAt: iso(since),
      });
    }
  }
  return out;
}

export function step(
  state: TrackerState, snap: InfraSnapshot, now: number, rules: TrackerRules, failedProviders: ReadonlySet<InfraProviderId> = new Set(),
): { events: InfraEvent[]; firing: FiringAlert[] } {
  const events: InfraEvent[] = [];
  const current = new Map<string, InfraAlert>();
  for (const a of snap.alerts) current.set(a.fingerprint, a);
  for (const r of snap.resources) {
    for (const a of thresholdAlerts(r, state, rules, now)) current.set(a.fingerprint, a);
    if (r.status === 'down') {
      current.set(`status:${r.id}`, { fingerprint: `status:${r.id}`, provider: r.provider, resourceId: r.id, resourceName: r.name, severity: 'critical', title: `${r.name} ${L(rules, 'fora do ar', 'is down')}${r.statusText ? ` (${r.statusText})` : ''}`, startedAt: iso(now) });
    }
    const prev = state.statuses.get(r.id);
    if (state.initialized && prev && prev !== r.status) {
      events.push({ key: `status:${r.id}:${now}`, kind: 'status', provider: r.provider, at: iso(now), title: `${r.name}: ${prev} → ${r.status}`, resourceId: r.id, resourceName: r.name, from: prev, to: r.status });
    }
    state.statuses.set(r.id, r.status);
  }

  // New firings (the first "status:" alert keeps the time it was first seen).
  for (const [fp, a] of current) {
    const known = state.firing.get(fp);
    if (known) { state.firing.set(fp, { ...known, ...a, startedAt: fp.startsWith('status:') ? known.startedAt : a.startedAt, severity: a.severity, title: a.title }); continue; }
    const f: FiringAlert = { ...a, firstSeenAt: iso(now), synthetic: fp.startsWith('limit:') || fp.startsWith('status:') };
    state.firing.set(fp, f);
    events.push({ key: `fired:${fp}:${a.startedAt}`, kind: 'alert_fired', provider: a.provider, at: a.startedAt, title: a.title, severity: a.severity, fingerprint: fp, resourceId: a.resourceId, resourceName: a.resourceName });
  }
  // Resolved: they left the list, unless the provider failed on this read.
  for (const [fp, f] of state.firing) {
    if (current.has(fp) || failedProviders.has(f.provider)) continue;
    state.firing.delete(fp);
    events.push({ key: `resolved:${fp}:${f.startedAt}`, kind: 'alert_resolved', provider: f.provider, at: iso(now), title: f.title, severity: f.severity, fingerprint: fp, resourceId: f.resourceId, resourceName: f.resourceName, durationMs: now - Date.parse(f.startedAt) });
  }

  for (const d of snap.deploys) {
    if (state.deploys.has(d.key)) continue;
    state.deploys.add(d.key);
    if (d.status === 'in_progress') { state.deploys.delete(d.key); continue; } // registra quando terminar
    events.push({ key: `deploy:${d.key}`, kind: 'deploy', provider: d.provider, at: d.at, title: `Deploy ${d.version ?? ''} ${L(rules, 'de', 'of')} ${d.resourceName}`.replace('  ', ' '), resourceId: d.resourceId, resourceName: d.resourceName, deploy: { version: d.version, status: d.status, description: d.description, url: d.url } });
  }
  state.initialized = true;
  return { events, firing: [...state.firing.values()].sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.startedAt.localeCompare(b.startedAt)) };
}

export const sevRank = (s: AlertSeverity) => (s === 'critical' ? 0 : s === 'warning' ? 1 : 2);

/** Successful deploy on the same resource up to `windowMin` minutes before the alert: suspected cause. */
export function suspectDeploy(alert: Pick<InfraAlert, 'resourceId' | 'resourceName' | 'startedAt'>, deploys: Array<Pick<InfraEvent, 'resourceId' | 'resourceName' | 'at' | 'deploy' | 'title'>>, windowMin = 60) {
  const t = Date.parse(alert.startedAt);
  const sameResource = (d: Pick<InfraEvent, 'resourceId' | 'resourceName'>) =>
    (!!alert.resourceId && d.resourceId === alert.resourceId) || (!!alert.resourceName && !!d.resourceName && d.resourceName.toLowerCase() === alert.resourceName.toLowerCase());
  return deploys
    .filter(d => d.deploy?.status === 'succeeded' && sameResource(d))
    .map(d => ({ d, gap: t - Date.parse(d.at) }))
    .filter(x => x.gap >= 0 && x.gap <= windowMin * 60_000)
    .sort((a, b) => a.gap - b.gap)[0]?.d;
}
