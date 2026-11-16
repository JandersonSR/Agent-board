// Execuções de agentes (painel_sessoes): review de PR por LLM e, na sequência, tarefas.
import type { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { AgentService } from '../agents/service.js';

const Id = z.object({ id: z.string().refine(ObjectId.isValid, 'id inválido') });
const PrUrl = z.string().url().regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+\/?$/, 'URL de PR do GitHub');

export async function runsRoutes(app: FastifyInstance, opts: { agents: AgentService }): Promise<void> {
  const { agents } = opts;

  app.post('/api/review/preview', async (req) => {
    const b = z.object({ url: PrUrl, title: z.string().max(300).optional() }).parse(req.body);
    return agents.previewReview(b.url, b.title);
  });

  app.post('/api/review/run', async (req) => {
    const b = z.object({ url: PrUrl, title: z.string().max(300).optional(), prompt: z.string().min(20).max(120_000).optional() }).parse(req.body);
    return agents.startReview({ prUrl: b.url, title: b.title, prompt: b.prompt });
  });

  app.post('/api/review/terminal', async (req) => agents.openReviewInTerminal(z.object({ url: PrUrl }).parse(req.body).url));
  app.post('/api/review/cursor', async (req) => agents.openInCursor(z.object({ url: PrUrl }).parse(req.body).url));

  app.get('/api/runs', async () => ({ running: agents.running, items: (await agents.list()).map(r => ({ ...r, _id: String(r._id) })) }));

  app.get('/api/runs/:id', async (req, reply) => {
    const r = await agents.get(Id.parse(req.params).id);
    if (!r) return reply.code(404).send({ error: 'não encontrada' });
    return { ...r, _id: String(r._id) };
  });

  app.post('/api/runs/:id/cancel', async (req, reply) => {
    if (!agents.cancel(Id.parse(req.params).id)) return reply.code(409).send({ error: 'execução não está rodando' });
    return { ok: true };
  });

  // Julgamento dos achados (manter/descartar): base da medição de qualidade e filtro da review PENDING.
  app.post('/api/runs/:id/feedback', async (req) => {
    const { decisions } = z.object({ decisions: z.array(z.enum(['accepted', 'rejected']).nullable()).max(60) }).parse(req.body);
    return { decisions: await agents.setFindingDecisions(Id.parse(req.params).id, decisions) };
  });

  app.get('/api/quality', async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
    return agents.reviewQuality(days);
  });

  // ---------- Tarefas de ponta a ponta ----------
  const IssueUrl = z.string().url().regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+\/?$/, 'URL de issue do GitHub');

  app.post('/api/task/preview', async (req) => agents.previewTask(z.object({ url: IssueUrl }).parse(req.body).url));

  app.post('/api/task/start', async (req) => {
    const b = z.object({ url: IssueUrl, prompt: z.string().min(20).max(120_000).optional() }).parse(req.body);
    return agents.startTask({ issueUrl: b.url, prompt: b.prompt });
  });

  app.post('/api/runs/:id/approve', async (req) => {
    const { notes } = z.object({ notes: z.string().max(4000).optional() }).parse(req.body ?? {});
    await agents.approveTask(Id.parse(req.params).id, notes);
    return { ok: true };
  });

  app.post('/api/runs/:id/discard', async (req) => { await agents.discardTask(Id.parse(req.params).id); return { ok: true }; });
  app.get('/api/runs/:id/diff', async (req) => agents.taskDiff(Id.parse(req.params).id));
  app.get('/api/runs/:id/patch', async (req, reply) => {
    const { file } = z.object({ file: z.string().max(400).optional() }).parse(req.query);
    return reply.type('text/plain; charset=utf-8').send(await agents.taskPatch(Id.parse(req.params).id, file));
  });

  // Ações que saem da máquina: só por clique, com confirmação na tela.
  app.post('/api/runs/:id/task-pr', async (req) => agents.openTaskPr(Id.parse(req.params).id));
  app.post('/api/runs/:id/pending-review', async (req) => agents.postPendingReview(Id.parse(req.params).id));
}
