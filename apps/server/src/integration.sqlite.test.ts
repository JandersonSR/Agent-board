// Integração com banco real (SQLite em arquivo temporário): rotas → repositórios → armazenamento.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-int-'));
process.env.AGENT_BOARD_DIR = path.join(tmp, 'sessions');

let app: FastifyInstance;
let close: () => Promise<void>;
const H = { host: '127.0.0.1:9999' };
const W = { ...H, 'x-agent-board': '1', 'content-type': 'application/json' };
const DAY = 86_400_000;
const day = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);

beforeAll(async () => {
  const { buildApp } = await import('./app.js');
  const { parseConfig } = await import('./config.js');
  const { PainelStore } = await import('./store/mongo.js');
  const { PrsRepo } = await import('./store/prs-repo.js');
  const config = parseConfig({ AGENT_BOARD_DB: path.join(tmp, 'data.db'), TEAM_TZ_OFFSET_MIN: '0' });
  const store = new PainelStore(config.mongo);
  await store.connect();
  // Duas entregas: uma normal e um hotfix, com PRs revisados.
  const prs = new PrsRepo(store);
  const now = new Date();
  for (const [n, title, rev] of [[1, 'Simulação de parcelas', ['Bruno']], [2, 'Hotfix: parcela', ['Bruno']]] as const) {
    await prs.upsertGroup({
      key: `https://github.com/acme/api/issues/${n}`, title, owner: 'Ana', projectDeployDate: day(-1),
      prs: [{ url: `https://github.com/acme/api/pull/${n}`, title, owner: 'Ana', status: 'merged', state: 'merged', repo: 'acme/api', number: n, mergedAt: new Date(now.getTime() - 2 * DAY), reviewers: [...rev], labels: [], head: n === 2 ? 'hotfix/parcela' : 'feat/x' }],
    }, new Date(now.getTime() - 5 * DAY));
  }
  app = await buildApp({ config, store, serveWeb: false });
  close = async () => { await app.close(); await store.close(); };
});
afterAll(async () => { await close(); fs.rmSync(tmp, { recursive: true, force: true }); });

describe('com SQLite real', () => {
  it('incidente: cria, edita, lista com avisos e exporta o postmortem', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/incidents', headers: W, payload: { title: 'Simulação fora do ar', severity: 'sev2', startedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), causeChanges: ['https://github.com/acme/api/issues/1'] } });
    expect(c.statusCode).toBe(200);
    const id = c.json().id as string;
    const p = await app.inject({ method: 'PATCH', url: `/api/incidents/${id}`, headers: W, payload: { status: 'resolved', actions: [{ id: 'a', text: 'Teste de contrato', due: day(-2), done: false }] } });
    expect(p.json()).toMatchObject({ status: 'resolved', postmortem: { status: 'pending' } });
    expect(p.json().resolvedAt).toBeTruthy();
    const l = (await app.inject({ method: 'GET', url: '/api/incidents', headers: H })).json();
    expect(l.items).toHaveLength(1);
    expect(l.alerts).toMatchObject({ open: 0, postmortemPending: [{ severity: 'sev2' }] });
    expect(l.alerts.overdueActions).toHaveLength(1);
    const md = await app.inject({ method: 'GET', url: `/api/incidents/${id}/postmortem.md`, headers: H });
    expect(md.body).toMatch(/^# Postmortem: Simulação fora do ar/);
  });

  it('DORA e conhecimento a partir das entregas e do incidente', async () => {
    const d = (await app.inject({ method: 'GET', url: '/api/dora?days=30', headers: H })).json();
    expect(d).toMatchObject({ configured: true, deploys: { items: 2, days: 1 }, changeFailure: { failures: 2, fixes: 1, incidents: 1 }, recovery: { resolved: 1 } });
    const k = (await app.inject({ method: 'GET', url: '/api/knowledge?days=30', headers: H })).json();
    expect(k.repos[0]).toMatchObject({ repo: 'acme/api', prs: 2, busFactor: 2, reviewers: [{ name: 'Bruno', prs: 2 }] });
  });

  it('decisões e iniciativa com progresso pelas issues acompanhadas', async () => {
    await app.inject({ method: 'POST', url: '/api/decisions', headers: W, payload: { title: 'Outbox de eventos', kind: 'rfc', decideBy: day(-1) } });
    const dec = (await app.inject({ method: 'GET', url: '/api/decisions', headers: H })).json();
    expect(dec.alerts).toMatchObject({ open: 1, overdue: 1 });
    const i = await app.inject({ method: 'POST', url: '/api/initiatives', headers: W, payload: {
      name: 'Empréstimo', stages: [
        { id: 'sim', name: 'Simulação', status: 'in_progress', query: 'simulação' },
        { id: 'contrato', name: 'Contrato', status: 'in_progress', dependsOn: ['sim'], issues: ['acme/api#2'] },
      ] } });
    expect(i.statusCode).toBe(200);
    const v = (await app.inject({ method: 'GET', url: '/api/initiatives', headers: H })).json().items[0].view;
    expect(v.stages[0]).toMatchObject({ merged: 1, deployed: 1, progress: 1 });
    expect(v.stages[1]).toMatchObject({ waitingOn: ['sim'], matched: [{ title: 'Hotfix: parcela' }] });
    const a = (await app.inject({ method: 'GET', url: '/api/staff/alerts', headers: H })).json();
    expect(a).toMatchObject({ configured: true, decisions: { overdue: 1 }, initiatives: [{ name: 'Empréstimo', blocked: 1 }] });
  });

  it('PRs e deploy e métricas do time leem o mesmo banco', async () => {
    const r = (await app.inject({ method: 'GET', url: '/api/prs?all=1', headers: H })).json();
    expect(r.items).toHaveLength(2);
    const t = (await app.inject({ method: 'GET', url: '/api/team-metrics?days=30', headers: H })).json();
    expect(t).toMatchObject({ configured: true, summary: { merged: 2 } });
  });
});
