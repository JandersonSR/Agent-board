import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { REPO_ROOT, type Config } from './config.js';
import { makeGuard } from './http/security.js';
import { createMasker } from './privacy/mask.js';
import { agentsRoutes } from './routes/agents.js';
import { boardRoutes } from './routes/board.js';
import { SyncService } from './sync/service.js';
import { healthRoutes } from './routes/health.js';
import { featMapRoutes } from './routes/featmaps.js';
import { FeatMapRegistry } from './featmap/registry.js';
import { AgentService } from './agents/service.js';
import { runsRoutes } from './routes/runs.js';
import { staffRoutes } from './routes/staff.js';
import { claudeAgentsRoutes } from './routes/claude-agents.js';
import { infraRoutes } from './routes/infra.js';
import { InfraService } from './infra/service.js';
import { ClaudeAgents, DemoClaudeAgents } from './sources/claude-agents.js';
import { peopleRoutes } from './routes/people.js';
import { GitHubClient } from './sources/github.js';
import { DeckStore } from './store/store.js';

export interface AppDeps { config: Config; store?: DeckStore; serveWeb?: boolean; startSync?: boolean }

export async function buildApp({ config, store = new DeckStore(config.mongo), serveWeb = true, startSync = false }: AppDeps): Promise<FastifyInstance> {
  const mask = createMasker(config.maskExtraPatterns);
  const app = Fastify({
    bodyLimit: 256 * 1024,
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // No request body, headers or query in the logs (they may hold personal data).
      serializers: {
        req: (req: { method: string; routeOptions?: { url?: string } }) => ({ method: req.method, route: req.routeOptions?.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    },
  });

  const allowed = makeGuard([config.port, config.webDevPort]);
  app.addHook('onRequest', async (req, reply) => {
    const ok = allowed({
      method: req.method,
      host: req.headers.host,
      origin: req.headers.origin,
      marker: req.headers['x-agent-board'] as string | undefined,
    });
    if (!ok) return reply.code(403).send({ error: 'origin not allowed' });
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'invalid input', issues: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
    }
    const e = err as Error & { statusCode?: number; stderr?: string };
    const status = e.statusCode && e.statusCode >= 400 ? e.statusCode : 500;
    // git/gh error messages may contain text: masked before they leave.
    const message = mask((e.stderr || e.message || 'erro').split('\n')[0]).text;
    if (status >= 500) app.log.error({ err: { name: e.name, message } }, 'route error');
    return reply.code(status).send({ error: message });
  });

  const featMaps = new FeatMapRegistry(config);
  await app.register(healthRoutes, { config, store, featMaps });
  await app.register(featMapRoutes, { registry: featMaps });
  await app.register(agentsRoutes, { port: config.port, approvalWait: config.approvalWait });

  const sync = new SyncService(config, store, mask, app.log);
  await app.register(boardRoutes, { sync, store });
  const infra = new InfraService(config, store, mask, app.log);
  await app.register(infraRoutes, { infra });
  await app.register(staffRoutes, { config, store, mask, infra });
  await app.register(claudeAgentsRoutes, { port: config.demo.on ? new DemoClaudeAgents() : new ClaudeAgents(), mask });

  const gh = config.github.org ? new GitHubClient({ token: config.github.token, login: config.github.login }) : undefined;
  const agents = new AgentService(config, store, gh, featMaps, mask, app.log);
  await app.register(runsRoutes, { agents });
  await app.register(peopleRoutes, { gh, org: config.github.org });
  if (startSync) app.addHook('onReady', async () => { await agents.init().catch(() => undefined); });
  if (startSync) {
    app.addHook('onReady', async () => { sync.start(); infra.start(); });
    app.addHook('onClose', async () => { sync.stop(); infra.stop(); });
  }

  const webDist = path.join(REPO_ROOT, 'apps', 'web', 'dist');
  if (serveWeb && fs.existsSync(webDist)) {
    // dynamic wildcard: a new web build shows up without restarting the server.
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && req.url !== '/events') return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not found' });
    });
  }

  return app;
}
