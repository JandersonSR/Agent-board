// v2 routes (live agents, approvals, review, launcher, metrics) ported to Fastify.
// The file contract with hook.js (sessions/, decisions/, server.json) does not change.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { v2, type V2Session } from '../legacy/v2.js';

const { store, git, launch, metrics } = v2;

const IdParam = z.object({ id: z.string().regex(/^[\w-]+$/) });
const DecisionBody = z.object({
  requestId: z.string().regex(/^[\w-]+$/),
  behavior: z.enum(['allow', 'deny']),
  message: z.string().max(500).optional(),
});
const LaunchBody = z.object({
  repo: z.string().trim().min(1),
  branch: z.string().trim().default(''),
  prompt: z.string().max(20_000).default(''),
  worktree: z.boolean().default(false),
  tool: z.enum(['claude', 'cursor']).default('claude'),
});
const MetricsQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });

const readSessions = (): V2Session[] =>
  store.readDir<V2Session>(store.SESSIONS).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

function findSession(id: string): V2Session & { cwd: string } {
  const s = store.readJson<V2Session>(store.sessionFile(id))
    ?? store.readJson<V2Session>(path.join(store.HISTORY, store.safeId(id) + '.json'));
  if (!s?.cwd) throw Object.assign(new Error('session without a folder'), { statusCode: 404 });
  if (!fs.existsSync(s.cwd)) throw Object.assign(new Error(`folder no longer exists: ${s.cwd}`), { statusCode: 404 });
  return s as V2Session & { cwd: string };
}

function archive(id: string): void {
  const file = store.sessionFile(id);
  const s = store.readJson<V2Session>(file);
  if (s) store.writeJson(path.join(store.HISTORY, store.safeId(id) + '.json'), { ...s, archivedAt: Date.now() });
  try { fs.unlinkSync(file); } catch { /* já removida */ }
}

export interface AgentsRoutesOptions { port: number; approvalWait: number }

export async function agentsRoutes(app: FastifyInstance, opts: AgentsRoutesOptions): Promise<void> {
  fs.mkdirSync(store.SESSIONS, { recursive: true });

  // ---- SSE + heartbeat (the hook only waits for approval on the deck when a tab is open) ----
  const clients = new Set<FastifyReply['raw']>();
  let lastPayload = '';
  const broadcast = (force = false) => {
    const payload = JSON.stringify(readSessions());
    if (!force && payload === lastPayload) return;
    lastPayload = payload;
    for (const res of clients) res.write(`data: ${payload}\n\n`);
  };
  const heartbeat = () => {
    try {
      store.writeJson(path.join(store.ROOT, 'server.json'), { pid: process.pid, port: opts.port, clients: clients.size, at: Date.now() });
    } catch { /* sem disco: ignora */ }
  };

  let debounce: NodeJS.Timeout | undefined;
  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(store.SESSIONS, () => { clearTimeout(debounce); debounce = setTimeout(() => broadcast(), 120); });
  } catch { /* sem watch: o polling cobre */ }
  const timers = [
    setInterval(() => broadcast(), 3000),
    setInterval(heartbeat, 5000),
    setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25_000),
  ];
  app.addHook('onClose', async () => {
    timers.forEach(clearInterval);
    clearTimeout(debounce);
    watcher?.close();
    for (const res of clients) res.end();
  });

  app.get('/events', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(readSessions())}\n\n`);
    clients.add(res);
    heartbeat();
    req.raw.on('close', () => { clients.delete(res); heartbeat(); });
  });

  // ---- Sessions ----
  app.get('/api/sessions', async () => readSessions());
  app.get('/api/config', async () => ({ approvalWait: opts.approvalWait, platform: process.platform }));

  app.post('/api/sessions/:id/dismiss', async (req) => {
    const { id } = IdParam.parse(req.params);
    archive(id); broadcast(true);
    return { ok: true };
  });

  app.post('/api/clear-ended', async () => {
    for (const s of readSessions()) if (s.state === 'ended') archive(s.id);
    broadcast(true);
    return { ok: true };
  });

  app.post('/api/sessions/:id/decision', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const body = DecisionBody.parse(req.body);
    const s = store.readJson<V2Session>(store.sessionFile(id));
    const pending = s?.approvals?.find(a => a.requestId === body.requestId && a.remote);
    if (!pending) return reply.code(409).send({ error: 'request already answered or expired' });
    store.writeJson(store.decisionFile(id, body.requestId), { ...body, at: Date.now() });
    return { ok: true };
  });

  // ---- Review (diff e PR) ----
  const prCache = new Map<string, { at: number; data: unknown }>();
  const PR_TTL = 60_000;

  app.get('/api/sessions/:id/diff', async (req) => {
    const s = findSession(IdParam.parse(req.params).id);
    return (await git.diffSummary(s.cwd)) ?? { error: 'not a git repository' };
  });

  app.get('/api/sessions/:id/patch', async (req, reply) => {
    const s = findSession(IdParam.parse(req.params).id);
    const file = z.object({ file: z.string().max(1000).optional() }).parse(req.query).file;
    return reply.type('text/plain; charset=utf-8').send(await git.diffPatch(s.cwd, file));
  });

  app.get('/api/sessions/:id/pr', async (req) => {
    const s = findSession(IdParam.parse(req.params).id);
    const fresh = z.object({ fresh: z.string().optional() }).parse(req.query).fresh !== undefined;
    const key = `${s.cwd}@${s.branch ?? ''}`;
    const hit = prCache.get(key);
    if (hit && !fresh && Date.now() - hit.at < PR_TTL) return hit.data;
    const data = await git.prStatus(s.cwd);
    prCache.set(key, { at: Date.now(), data });
    return data;
  });

  // Push + draft PR: only on an explicit click (the UI asks for confirmation).
  app.post('/api/sessions/:id/pr', async (req) => {
    const s = findSession(IdParam.parse(req.params).id);
    const url = await git.createPr(s.cwd);
    prCache.clear();
    return { url };
  });

  // ---- Launcher ----
  app.post('/api/launch', async (req) => launch.launch(LaunchBody.parse(req.body)));

  app.get('/api/repos', async () => {
    const all = [...readSessions(), ...store.readDir<V2Session>(store.HISTORY)].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return [...new Set(all.map(s => s.cwd).filter((c): c is string => !!c))].slice(0, 30);
  });

  // ---- Metrics ----
  app.get('/api/metrics', async (req) => {
    const { days } = MetricsQuery.parse(req.query);
    const sessions = [...readSessions(), ...store.readDir<V2Session>(store.HISTORY)];
    return metrics.computeMetrics(store.readEvents(Date.now() - days * 86_400_000), sessions, days);
  });
}
