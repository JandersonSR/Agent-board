import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// lib/store.js do v2 lê AGENT_BOARD_DIR na importação: definir antes de importar o app.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-board-test-'));
process.env.AGENT_BOARD_DIR = path.join(tmp, 'sessions');

let app: FastifyInstance;
const HOST = '127.0.0.1:9999';

beforeAll(async () => {
  const { buildApp } = await import('./app.js');
  const { parseConfig } = await import('./config.js');
  app = await buildApp({ config: parseConfig({}), serveWeb: false });
  fs.mkdirSync(process.env.AGENT_BOARD_DIR!, { recursive: true });
  fs.writeFileSync(path.join(process.env.AGENT_BOARD_DIR!, 's1.json'), JSON.stringify({
    id: 's1', state: 'needs_you', createdAt: 1, updatedAt: 2,
    approvals: [{ requestId: 'r1', at: 2, summary: 'Bash: ls', detail: '{}', remote: true }],
  }));
});
afterAll(async () => { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

describe('app', () => {
  it('recusa host externo', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/sessions', headers: { host: 'evil.example' } });
    expect(r.statusCode).toBe(403);
  });

  it('lista sessões do v2', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/sessions', headers: { host: HOST } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveLength(1);
  });

  it('valida o corpo da decisão com Zod', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/sessions/s1/decision',
      headers: { host: HOST, 'x-agent-board': '1', 'content-type': 'application/json' },
      payload: { requestId: 'r1', behavior: 'talvez' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('entrada inválida');
  });

  it('grava a decisão para o hook (contrato de arquivos inalterado)', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/sessions/s1/decision',
      headers: { host: HOST, 'x-agent-board': '1', 'content-type': 'application/json' },
      payload: { requestId: 'r1', behavior: 'allow' },
    });
    expect(r.statusCode).toBe(200);
    expect(fs.existsSync(path.join(tmp, 'decisions', 's1-r1.json'))).toBe(true);
  });

  it('escrita sem o cabeçalho marcador é recusada', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/clear-ended', headers: { host: HOST } });
    expect(r.statusCode).toBe(403);
  });
});

describe('rotas de deploy (validação)', () => {
  it('recusa data de deploy fora do formato ao acompanhar issue', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/prs',
      headers: { host: HOST, 'x-agent-board': '1', 'content-type': 'application/json' },
      payload: { issue: 'org/repo#1', deployDate: '20/11/2026' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('recusa status desconhecido no ajuste manual', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/api/prs/507f1f77bcf86cd799439011/pr',
      headers: { host: HOST, 'x-agent-board': '1', 'content-type': 'application/json' },
      payload: { url: 'https://github.com/o/r/pull/1', status: 'quase_la' },
    });
    expect(r.statusCode).toBe(400);
  });

  describe('visão de Staff sem MongoDB', () => {
    const W = { host: HOST, 'x-agent-board': '1', 'content-type': 'application/json' };

    it('DORA, conhecimento e listas respondem "não configurado"', async () => {
      for (const url of ['/api/dora?days=30', '/api/knowledge', '/api/incidents', '/api/decisions', '/api/initiatives', '/api/staff/alerts']) {
        const r = await app.inject({ method: 'GET', url, headers: { host: HOST } });
        expect(r.statusCode, url).toBe(200);
        expect(r.json().configured, url).toBe(false);
      }
    });

    it('valida incidente antes de tocar no banco', async () => {
      const r = await app.inject({ method: 'POST', url: '/api/incidents', headers: W, payload: { title: 'x', severity: 'sev9', startedAt: '2026-11-16' } });
      expect(r.statusCode).toBe(400);
      const ok = await app.inject({ method: 'POST', url: '/api/incidents', headers: W, payload: { title: 'x', severity: 'sev2', startedAt: '2026-11-16T10:00:00Z' } });
      expect(ok.statusCode).toBe(503);
    });

    it('recusa dependência circular entre etapas', async () => {
      const r = await app.inject({
        method: 'POST', url: '/api/initiatives', headers: W,
        payload: { name: 'Empréstimo', stages: [{ id: 'a', name: 'A', dependsOn: ['b'] }, { id: 'b', name: 'B', dependsOn: ['a'] }] },
      });
      expect(r.statusCode).toBe(400);
      expect(JSON.stringify(r.json())).toMatch(/circular/);
    });

    it('DELETE sem o cabeçalho do painel é recusado', async () => {
      const r = await app.inject({ method: 'DELETE', url: '/api/incidents/0123456789abcdef01234567', headers: { host: HOST } });
      expect(r.statusCode).toBe(403);
    });

    it('caso de avaliação exige arquivo ou palavra-chave', async () => {
      const r = await app.inject({ method: 'POST', url: '/api/evals', headers: W, payload: { name: 'x', prUrl: 'https://github.com/o/r/pull/1', expected: [{ id: 'a', keywords: [] }] } });
      expect(r.statusCode).toBe(400);
    });
  });
});
