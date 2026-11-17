import { describe, expect, it } from 'vitest';
import { parseConfig } from '../config.js';
import { PainelStore } from '../store/mongo.js';
import { InfraService } from './service.js';
import type { InfraProvider, InfraSnapshot } from './types.js';

const MIN = 60_000;
const T0 = Date.parse('2026-11-16T12:00:00Z');

/** Provedor programável: cada leitura devolve o que o teste mandar (ou falha). */
function scripted() {
  let next: InfraSnapshot | Error = { resources: [], alerts: [], deploys: [] };
  const p: InfraProvider = { id: 'heroku', label: 'Fake', poll: async () => { if (next instanceof Error) throw next; return next; } };
  return { p, set: (s: InfraSnapshot | Error) => { next = s; } };
}
const api = (cpu: number) => ({ id: 'heroku:app:1', provider: 'heroku' as const, kind: 'app', name: 'api-prod', status: 'ok' as const, metrics: { cpu } });
const deploy = { key: 'heroku:1:v42', provider: 'heroku' as const, resourceId: 'heroku:app:1', resourceName: 'api-prod', version: 'v42', status: 'succeeded' as const, at: new Date(T0 - 20 * MIN).toISOString() };

describe('InfraService', () => {
  it('alerta crítico de produção abre incidente com suspeita de causa e a resolução marca a mitigação', async () => {
    const store = new PainelStore({ uri: undefined, dbName: undefined, legacyPr: undefined, storage: 'sqlite', sqliteFile: ':memory:' });
    await store.connect();
    const { p, set } = scripted();
    const cfg = parseConfig({ STORAGE: 'sqlite', INFRA_SUSTAIN_MIN: '5' });
    const svc = new InfraService(cfg, store, s => ({ text: s.replace(/joao@x\.com/g, '[e-mail]') }), { warn: () => undefined, error: () => undefined }, [p]);

    set({ resources: [api(95)], alerts: [{ fingerprint: 'g:lat', provider: 'heroku', title: 'Latência alta em api-prod', severity: 'warning', startedAt: new Date(T0).toISOString(), resourceName: 'api-prod' }], deploys: [deploy] });
    await svc.pollOnce(T0);
    expect(svc.view().firing.find(f => f.fingerprint === 'g:lat')?.suspect?.version).toBe('v42'); // deploy e alerta na mesma leitura
    set({ resources: [api(96)], alerts: [], deploys: [deploy] }); // o alerta de latência some aqui
    await svc.pollOnce(T0 + 5 * MIN);

    const v = svc.view();
    const cpu = v.firing.find(f => f.fingerprint.startsWith('limit:'))!;
    expect(cpu).toMatchObject({ severity: 'critical', suspect: { version: 'v42' } });
    const incidentId = cpu.incidentId!;
    const inc = await store.collection('painel_incidentes').findOne({});
    expect(String(inc!._id)).toBe(incidentId);
    expect(inc).toMatchObject({ severity: 'sev2', status: 'open', source: 'infra', services: ['api-prod'] });
    expect((inc!.timeline as Array<{ text: string }>).map(t => t.text)).toEqual([expect.stringMatching(/Deploy v42 de api-prod: possível causa/), expect.stringMatching(/Alerta disparado/)]);

    // leitura falhou: nada resolve
    set(new Error('heroku: tempo esgotado'));
    await svc.pollOnce(T0 + 6 * MIN);
    expect(svc.view().firing.filter(f => f.fingerprint.startsWith('limit:'))).toHaveLength(1);
    expect(svc.view().providers[0]).toMatchObject({ ok: false, error: 'heroku: tempo esgotado' });

    set({ resources: [api(30)], alerts: [], deploys: [deploy], warnings: ['droplets: token sem escopo droplet:read'] });
    await svc.pollOnce(T0 + 9 * MIN);
    expect(svc.view().providers[0]).toMatchObject({ ok: true, error: undefined, warning: 'droplets: token sem escopo droplet:read' }); // leitura parcial
    expect(svc.view().firing).toHaveLength(0);
    const after = await store.collection('painel_incidentes').findOne({});
    expect(after).toMatchObject({ status: 'mitigated' });
    expect((after!.timeline as Array<{ text: string }>).at(-1)!.text).toBe('Alerta resolvido após 9 min');

    const kinds = (await svc.recentEvents(30)).map(e => (e as unknown as { kind: string }).kind).sort();
    expect(kinds).toEqual(['alert_fired', 'alert_fired', 'alert_resolved', 'alert_resolved', 'deploy']);
    expect(await svc.productionDeploys(T0 - 60 * MIN)).toEqual([{ at: deploy.at, resource: 'api-prod' }]);
    await store.close();
  });

  it('fora de produção ou com a regra desligada não abre incidente; dá para abrir por clique', async () => {
    const store = new PainelStore({ uri: undefined, dbName: undefined, legacyPr: undefined, storage: 'sqlite', sqliteFile: ':memory:' });
    await store.connect();
    const { p, set } = scripted();
    const svc = new InfraService(parseConfig({ STORAGE: 'sqlite', INFRA_SUSTAIN_MIN: '0' }), store, s => ({ text: s }), { warn: () => undefined, error: () => undefined }, [p]);
    set({ resources: [{ ...api(99), name: 'api-staging' }], alerts: [{ fingerprint: 'g:1', provider: 'heroku', title: 'Contato joao@x.com', severity: 'warning', startedAt: new Date(T0).toISOString() }], deploys: [] });
    await svc.pollOnce(T0);
    expect(await store.collection('painel_incidentes').countDocuments({})).toBe(0);
    expect(svc.view().firing.map(f => f.severity)).toEqual(['critical', 'warning']);
    const id = await svc.openIncidentFor('g:1');
    expect(await store.collection('painel_incidentes').countDocuments({})).toBe(1);
    expect(await svc.openIncidentFor('g:1')).toBe(id); // não duplica
    await expect(svc.openIncidentFor('nao-existe')).rejects.toThrow(/não está mais disparado/);
    await store.close();
  });
});
