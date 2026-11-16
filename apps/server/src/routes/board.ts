// Blocos do Tech Lead: fila, reviews, daily, bloqueios e PRs/deploy.
import type { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { STATUSES } from '../domain/pr-status.js';
import type { PainelStore } from '../store/mongo.js';
import { PrsRepo, type TrackedIssue } from '../store/prs-repo.js';
import type { SyncService } from '../sync/service.js';

const PatchPr = z.object({
  deployDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  team: z.string().trim().max(60).optional(),
  owner: z.string().trim().max(60).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  deployOrder: z.number().int().min(0).max(999).nullable().optional(),
}).strict();

const isOverdue = (d: TrackedIssue, today: string) => !!d.deployDate && d.deployDate < today && d.status !== 'merged';

export async function boardRoutes(app: FastifyInstance, opts: { sync: SyncService; store: PainelStore }): Promise<void> {
  const { sync, store } = opts;
  const repo = new PrsRepo(store);

  app.get('/api/board/status', async () => ({ sources: sync.state }));

  app.post('/api/sync', async () => { await sync.run(); return { sources: sync.state }; });

  app.get('/api/queue', async () => ({ source: { github: sync.state.github, discord: sync.state.discord }, items: sync.queue }));

  app.get('/api/reviews', async () => ({ source: sync.state.github, items: sync.reviews }));

  app.get('/api/daily', async () => ({ source: sync.state.discord, summary: sync.daily ?? null }));

  app.get('/api/blockers', async () => ({ source: sync.state.discord, items: sync.blockers }));

  app.get('/api/prs', async (req) => {
    const { all } = z.object({ all: z.string().optional() }).parse(req.query);
    if (!store.configured) return { source: sync.state.prs, items: [], statuses: STATUSES };
    await store.connect();
    const today = new Date().toISOString().slice(0, 10);
    const docs = await repo.list({ includeOldMerged: all !== undefined });
    const items = docs
      .map(d => ({ ...d, _id: String(d._id), overdue: isOverdue(d, today) }))
      .sort((a, b) =>
        Number(b.overdue) - Number(a.overdue)
        || Number(a.status === 'merged') - Number(b.status === 'merged')
        || (a.deployDate ?? '9999').localeCompare(b.deployDate ?? '9999')
        || +new Date(b.updatedAt) - +new Date(a.updatedAt));
    return { source: sync.state.prs, items, statuses: STATUSES, projectScope: sync.projectScope, projects: sync.projectsConfigured };
  });

  // Acompanhar uma issue: os PRs ligados a ela são encontrados e atualizados sozinhos.
  app.post('/api/prs', async (req) => {
    const body = z.object({
      issue: z.string().trim().min(1).max(300),
      deployDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.body);
    return sync.trackIssue(body.issue, body.deployDate);
  });

  app.post('/api/prs/:id/archive', async (req, reply) => {
    const { id } = z.object({ id: z.string().refine(ObjectId.isValid, 'id inválido') }).parse(req.params);
    const { archived } = z.object({ archived: z.boolean().default(true) }).parse(req.body ?? {});
    await store.connect();
    if (!(await repo.archive(id, archived))) return reply.code(404).send({ error: 'não encontrado' });
    return { ok: true };
  });

  // Ajuste manual do status de um PR (ex.: re-review). null remove o ajuste.
  app.patch('/api/prs/:id/pr', async (req, reply) => {
    const { id } = z.object({ id: z.string().refine(ObjectId.isValid, 'id inválido') }).parse(req.params);
    const body = z.object({ url: z.string().url(), status: z.enum(STATUSES).nullable() }).parse(req.body);
    await store.connect();
    const doc = await repo.setOverride(id, body.url, body.status);
    if (!doc) return reply.code(404).send({ error: 'PR não encontrado nesta issue' });
    return { ...doc, _id: String(doc._id) };
  });

  app.patch('/api/prs/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().refine(ObjectId.isValid, 'id inválido') }).parse(req.params);
    const fields = PatchPr.parse(req.body);
    await store.connect();
    const doc = await repo.patch(id, fields);
    if (!doc) return reply.code(404).send({ error: 'não encontrado' });
    return { ...doc, _id: String(doc._id) };
  });
}
