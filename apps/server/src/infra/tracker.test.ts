import { describe, expect, it } from 'vitest';
import { newTrackerState, step, suspectDeploy } from './tracker.js';
import type { InfraResource, InfraSnapshot } from './types.js';

const RULES = { cpuWarn: 80, cpuCrit: 90, memCrit: 90, sustainMin: 5 };
const MIN = 60_000;
const T0 = Date.parse('2026-11-16T12:00:00Z');
const res = (cpu: number, status: InfraResource['status'] = 'ok'): InfraResource => ({ id: 'digitalocean:droplet:1', provider: 'digitalocean', kind: 'droplet', name: 'api-prod', status, metrics: { cpu } });
const snap = (r: InfraResource[], extra: Partial<InfraSnapshot> = {}): InfraSnapshot => ({ resources: r, alerts: [], deploys: [], ...extra });

describe('tracker', () => {
  it('CPU alta só vira alerta depois de sustentada, e resolve quando cai', () => {
    const s = newTrackerState();
    expect(step(s, snap([res(95)]), T0, RULES).events).toEqual([]);
    expect(step(s, snap([res(96)]), T0 + 4 * MIN, RULES).events).toEqual([]);
    const fired = step(s, snap([res(97)]), T0 + 5 * MIN, RULES);
    expect(fired.events).toEqual([expect.objectContaining({ kind: 'alert_fired', severity: 'critical', fingerprint: 'limit:digitalocean:droplet:1:cpu', at: new Date(T0).toISOString() })]);
    expect(fired.firing).toHaveLength(1);
    expect(step(s, snap([res(97)]), T0 + 6 * MIN, RULES).events).toEqual([]); // não repete
    const resolved = step(s, snap([res(40)]), T0 + 9 * MIN, RULES);
    expect(resolved.events).toEqual([expect.objectContaining({ kind: 'alert_resolved', durationMs: 9 * MIN })]);
  });

  it('pico curto não dispara', () => {
    const s = newTrackerState();
    step(s, snap([res(95)]), T0, RULES);
    step(s, snap([res(50)]), T0 + 2 * MIN, RULES);
    expect(step(s, snap([res(95)]), T0 + 6 * MIN, RULES).events).toEqual([]);
  });

  it('recurso fora do ar, mudança de estado e provedor com falha não resolve', () => {
    const s = newTrackerState();
    step(s, snap([res(10)]), T0, RULES);
    const down = step(s, snap([res(10, 'down')]), T0 + MIN, RULES);
    expect(down.events.map(e => e.kind).sort()).toEqual(['alert_fired', 'status']);
    // a leitura do DigitalOcean falhou: sem recursos, mas o alerta continua
    expect(step(s, snap([]), T0 + 2 * MIN, RULES, new Set(['digitalocean'])).events).toEqual([]);
    expect(step(s, snap([res(10, 'ok')]), T0 + 3 * MIN, RULES).events.map(e => e.kind).sort()).toEqual(['alert_resolved', 'status']);
  });

  it('alertas de provedor e deploys novos (em andamento só ao terminar)', () => {
    const s = newTrackerState();
    const alert = { fingerprint: 'grafana:f1', provider: 'grafana' as const, title: 'Latência alta', severity: 'warning' as const, startedAt: '2026-11-16T11:58:00Z' };
    const deploy = { key: 'heroku:h1:v42', provider: 'heroku' as const, resourceId: 'heroku:app:h1', resourceName: 'payments', version: 'v42', at: '2026-11-16T11:50:00Z' };
    const a = step(s, snap([], { alerts: [alert], deploys: [{ ...deploy, status: 'in_progress' }] }), T0, RULES);
    expect(a.events.map(e => e.kind)).toEqual(['alert_fired']);
    const b = step(s, snap([], { alerts: [alert], deploys: [{ ...deploy, status: 'succeeded' }] }), T0 + MIN, RULES);
    expect(b.events).toEqual([expect.objectContaining({ kind: 'deploy', title: 'Deploy v42 de payments' })]);
    expect(step(s, snap([], { alerts: [], deploys: [{ ...deploy, status: 'succeeded' }] }), T0 + 2 * MIN, RULES).events.map(e => e.kind)).toEqual(['alert_resolved']);
  });

  it('suspeita de causa: deploy no mesmo recurso até 60 min antes', () => {
    const deploys = [
      { resourceId: 'r1', resourceName: 'api', at: '2026-11-16T11:30:00Z', deploy: { status: 'succeeded' as const, version: 'v9' }, title: 'd9' },
      { resourceId: 'r1', resourceName: 'api', at: '2026-11-16T10:00:00Z', deploy: { status: 'succeeded' as const, version: 'v8' }, title: 'd8' },
      { resourceId: 'r2', resourceName: 'web', at: '2026-11-16T11:50:00Z', deploy: { status: 'succeeded' as const, version: 'w1' }, title: 'w1' },
    ];
    expect(suspectDeploy({ resourceId: 'r1', startedAt: '2026-11-16T12:00:00Z' }, deploys)?.deploy?.version).toBe('v9');
    expect(suspectDeploy({ resourceName: 'API', startedAt: '2026-11-16T12:00:00Z' }, deploys)?.deploy?.version).toBe('v9');
    expect(suspectDeploy({ resourceId: 'r1', startedAt: '2026-11-16T13:00:00Z' }, deploys)).toBeUndefined();
  });
});
