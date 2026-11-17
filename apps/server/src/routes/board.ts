// Tech Lead blocks: queue, reviews, daily, blockers and PRs/deploys.
import type { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { isDone, STATUSES } from '../domain/pr-status.js';
import { computeTeamMetrics } from '../domain/team-metrics.js';
import type { DeckStore } from '../store/store.js';
import { PrsRepo, type TrackedIssue } from '../store/prs-repo.js';
import type { SyncService } from '../sync/service.js';

const PatchPr = z.object({
  deployDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  team: z.string().trim().max(60).optional(),
  owner: z.string().trim().max(60).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  deployOrder: z.number().int().min(0).max(999).nullable().optional(),
}).strict();

const isOverdue = (d: TrackedIssue, today: string) => !!d.deployDate && d.deployDate < today && !isDone(d.status);

export async function boardRoutes(app: FastifyInstance, opts: { sync: SyncService; store: DeckStore }): Promise<void> {
  const { sync, store } = opts;
  const repo = new PrsRepo(store);

  app.get('/api/board/status', async () => ({ sources: sync.state, demo: sync.demo }));

  app.post('/api/sync', async () => { await sync.run(); return { sources: sync.state }; });

  app.get('/api/queue', async () => ({ source: { github: sync.state.github, chat: sync.state.chat, tracker: sync.state.tracker }, items: sync.queue }));

  app.get('/api/reviews', async () => ({ source: sync.state.github, items: sync.reviews }));

  app.get('/api/daily', async () => ({ source: sync.state.chat, summary: sync.daily ?? null }));

  app.get('/api/blockers', async () => ({ source: sync.state.chat, items: sync.blockers }));

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
        || Number(isDone(a.status)) - Number(isDone(b.status))
        || (a.deployDate ?? '9999').localeCompare(b.deployDate ?? '9999')
        || +new Date(b.updatedAt) - +new Date(a.updatedAt));
    return { source: sync.state.prs, items, statuses: STATUSES, projectScope: sync.projectScope, projects: sync.projectsConfigured };
  });

  // Team delivery flow (review wait, changes requested, size, time to merge).
  app.get('/api/team-metrics', async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }).parse(req.query);
    if (!store.configured) return { configured: false, ...computeTeamMetrics([], days) };
    await store.connect();
    const docs = await repo.listForMetrics(new Date(Date.now() - days * 86_400_000));
    return { configured: true, ...computeTeamMetrics(docs, days) };
  });

  // Track an issue: the PRs linked to it are found and updated on their own.
  app.post('/api/prs', async (req) => {
    const body = z.object({
      issue: z.string().trim().min(1).max(300),
      deployDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.body);
    return sync.trackIssue(body.issue, body.deployDate);
  });

  app.post('/api/prs/:id/archive', async (req, reply) => {
    const { id } = z.object({ id: z.string().refine(ObjectId.isValid, 'invalid id') }).parse(req.params);
    const { archived } = z.object({ archived: z.boolean().default(true) }).parse(req.body ?? {});
    await store.connect();
    if (!(await repo.archive(id, archived))) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });

  // Manual status override of a PR (e.g. re-review). null removes the override.
  app.patch('/api/prs/:id/pr', async (req, reply) => {
    const { id } = z.object({ id: z.string().refine(ObjectId.isValid, 'invalid id') }).parse(req.params);
    const body = z.object({ url: z.string().url(), status: z.enum(STATUSES).nullable() }).parse(req.body);
    await store.connect();
    const doc = await repo.setOverride(id, body.url, body.status);
    if (!doc) return reply.code(404).send({ error: 'PR not found in this issue' });
    return { ...doc, _id: String(doc._id) };
  });

  app.patch('/api/prs/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().refine(ObjectId.isValid, 'invalid id') }).parse(req.params);
    const fields = PatchPr.parse(req.body);
    await store.connect();
    const doc = await repo.patch(id, fields);
    if (!doc) return reply.code(404).send({ error: 'not found' });
    return { ...doc, _id: String(doc._id) };
  });
}
