// Pessoas para os filtros da tela: meu login e os times da org (com membros). Cache de 1 h.
import type { FastifyInstance } from 'fastify';
import { fetchOrgTeams, type GitHubClient } from '../sources/github.js';

export async function peopleRoutes(app: FastifyInstance, opts: { gh: GitHubClient | undefined; org: string | undefined }): Promise<void> {
  let cache: { at: number; data: { me: string | null; teams: Array<{ slug: string; name: string; members: string[] }> } } | undefined;

  app.get('/api/github/people', async (req) => {
    const fresh = (req.query as Record<string, unknown>)['fresh'] !== undefined;
    if (!opts.gh || !opts.org) return { me: null, teams: [] };
    if (!fresh && cache && Date.now() - cache.at < 3_600_000) return cache.data;
    const [me, teams] = await Promise.all([opts.gh.viewerLogin(), fetchOrgTeams(opts.gh, opts.org).catch(() => [])]);
    cache = { at: Date.now(), data: { me, teams } };
    return cache.data;
  });
}
