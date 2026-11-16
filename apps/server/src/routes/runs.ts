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

  // Ação que sai da máquina: só por clique, com confirmação na tela.
  app.post('/api/runs/:id/pending-review', async (req) => agents.postPendingReview(Id.parse(req.params).id));
}
