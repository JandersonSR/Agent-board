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
import { PainelStore } from './store/mongo.js';

export interface AppDeps { config: Config; store?: PainelStore; serveWeb?: boolean; startSync?: boolean }

export async function buildApp({ config, store = new PainelStore(config.mongo), serveWeb = true, startSync = false }: AppDeps): Promise<FastifyInstance> {
  const mask = createMasker(config.maskExtraPatterns);
  const app = Fastify({
    bodyLimit: 256 * 1024,
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Nada de corpo de requisição, cabeçalhos ou query nos logs (podem ter dados pessoais).
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
    if (!ok) return reply.code(403).send({ error: 'origem não permitida' });
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'entrada inválida', issues: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
    }
    const e = err as Error & { statusCode?: number; stderr?: string };
    const status = e.statusCode && e.statusCode >= 400 ? e.statusCode : 500;
    // Mensagens de erro de git/gh podem conter trechos de texto: mascaradas antes de sair.
    const message = mask((e.stderr || e.message || 'erro').split('\n')[0]).text;
    if (status >= 500) app.log.error({ err: { name: e.name, message } }, 'erro na rota');
    return reply.code(status).send({ error: message });
  });

  const featMaps = new FeatMapRegistry(config);
  await app.register(healthRoutes, { config, store, featMaps });
  await app.register(featMapRoutes, { registry: featMaps });
  await app.register(agentsRoutes, { port: config.port, approvalWait: config.approvalWait });

  const sync = new SyncService(config, store, mask, app.log);
  await app.register(boardRoutes, { sync, store });
  if (startSync) {
    app.addHook('onReady', async () => sync.start());
    app.addHook('onClose', async () => sync.stop());
  }

  const webDist = path.join(REPO_ROOT, 'apps', 'web', 'dist');
  if (serveWeb && fs.existsSync(webDist)) {
    // wildcard dinâmico: um build novo da web aparece sem reiniciar o servidor.
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && req.url !== '/events') return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not found' });
    });
  }

  return app;
}
