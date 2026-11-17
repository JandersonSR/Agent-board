// Infraestrutura em tempo real (só leitura): estado dos recursos, alertas disparados, deploys e eventos.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { InfraService } from '../infra/service.js';

export async function infraRoutes(app: FastifyInstance, opts: { infra: InfraService }): Promise<void> {
  const { infra } = opts;
  app.get('/api/infra', async () => infra.view());
  app.get('/api/infra/events', async (req) => {
    const q = z.object({ days: z.coerce.number().int().min(1).max(90).default(7), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query);
    return { items: await infra.recentEvents(q.days, q.limit) };
  });
  app.post('/api/infra/refresh', async () => { await infra.pollOnce(); return infra.view(); });
  // Abre um incidente a partir de um alerta disparado (o fingerprint tem ":" e vai no corpo).
  app.post('/api/infra/incident', async (req) => {
    const { fingerprint } = z.object({ fingerprint: z.string().min(3).max(500) }).parse(req.body);
    return { id: await infra.openIncidentFor(fingerprint) };
  });
}
