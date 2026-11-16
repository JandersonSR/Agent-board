// RAGs de features: estado de cada um e busca (usada no prompt das sessões da Fase 3).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { FeatMapRegistry } from '../featmap/registry.js';

const SearchQuery = z.object({
  q: z.string().trim().min(2).max(2000),
  repo: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export async function featMapRoutes(app: FastifyInstance, opts: { registry: FeatMapRegistry }): Promise<void> {
  app.get('/api/featmaps', async () => {
    const { maps } = await opts.registry.all();
    return { maps };
  });

  app.get('/api/featmaps/search', async (req) => {
    const { q, repo, limit } = SearchQuery.parse(req.query);
    const r = await opts.registry.search(q, { repo, limit });
    return {
      maps: r.maps,
      hits: r.hits.map(h => ({
        map: h.pack.map, id: h.pack.id, title: h.pack.title, domain: h.pack.domain, repos: h.pack.repos,
        summary: h.pack.summary.slice(0, 400), tokens: h.pack.tokens, score: h.score, matched: h.matched,
      })),
    };
  });
}
