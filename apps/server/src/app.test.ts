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
