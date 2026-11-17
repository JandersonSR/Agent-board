// Background sessions from Claude Code's agent view: list, view logs (masked) and stop (on click).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BG_ID, type ClaudeAgentsPort } from '../sources/claude-agents.js';

export async function claudeAgentsRoutes(app: FastifyInstance, opts: { port: ClaudeAgentsPort; mask: (s: string) => { text: string } }): Promise<void> {
  const Id = z.object({ id: z.string().regex(BG_ID, 'invalid session id') });
  app.get('/api/claude-agents', async () => {
    const r = await opts.port.list();
    if (!r.available) return r;
    return { available: true, sessions: r.sessions.map(s => ({ ...s, ...(s.name ? { name: opts.mask(s.name).text } : {}) })) };
  });
  app.get('/api/claude-agents/:id/logs', async (req) => ({ text: opts.mask(await opts.port.logs(Id.parse(req.params).id)).text }));
  app.post('/api/claude-agents/:id/stop', async (req) => { await opts.port.stop(Id.parse(req.params).id); return { ok: true }; });
}
