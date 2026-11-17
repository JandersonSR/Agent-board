// Real-time infrastructure (read-only): resource state, firing alerts, deploys and events.
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
  // Opens an incident from a firing alert (the fingerprint has ":" and goes in the body).
  app.post('/api/infra/incident', async (req) => {
    const { fingerprint } = z.object({ fingerprint: z.string().min(3).max(500) }).parse(req.body);
    return { id: await infra.openIncidentFor(fingerprint) };
  });
}
