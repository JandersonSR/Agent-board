// Shared context for agent runs: configuration, cost limits, live log and the lifecycle
// of the Claude process (start, follow, cancel). The review, task and eval services use this context.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { FeatMapRegistry } from '../featmap/registry.js';
import type { MaskResult } from '../privacy/mask.js';
import type { GitHubClient } from '../sources/github.js';
import type { DeckStore } from '../store/store.js';
import { runClaude, type RunEvent, type RunHandle } from './claude-runner.js';
import { limitReason, startOfLocalDay } from './limits.js';
import { RunsRepo, type RunLogEntry } from './runs-repo.js';

export type Mask = (s: string) => MaskResult;
export type RunResult = Awaited<RunHandle['promise']>;

const PR_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/;
export function parsePrUrl(url: string): { owner: string; repo: string; number: number } | undefined {
  const m = url.match(PR_URL);
  return m ? { owner: m[1]!, repo: m[2]!, number: Number(m[3]) } : undefined;
}

// Review: read-only. The agent cannot post anything (gh api, review, comment, merge and push are denied).
export const REVIEW_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'];
export const REVIEW_ALLOWED = ['Read', 'Grep', 'Glob', 'Bash(gh pr view:*)', 'Bash(gh pr diff:*)', 'Bash(gh pr checks:*)', 'mcp__feat-map'];
export const ALWAYS_DENIED = [
  'Bash(gh api:*)', 'Bash(gh pr review:*)', 'Bash(gh pr comment:*)', 'Bash(gh pr merge:*)', 'Bash(gh pr close:*)',
  'Bash(gh pr edit:*)', 'Bash(gh issue:*)', 'Bash(git push:*)', 'Bash(curl:*)', 'Bash(wget:*)', 'WebFetch', 'WebSearch',
];

export class AgentContext {
  readonly runs: RunsRepo;
  readonly active = new Map<string, RunHandle>();

  constructor(
    readonly cfg: Config,
    readonly store: DeckStore,
    readonly gh: GitHubClient | undefined,
    readonly featMaps: FeatMapRegistry,
    readonly mask: Mask,
    readonly log: FastifyBaseLogger,
  ) {
    this.runs = new RunsRepo(store);
  }

  skill(role: 'review' | 'reviewInbox' | 'daily' | 'dailyDigest'): string | undefined {
    const kit = this.cfg.paths.skillsKit;
    const name = this.cfg.skills[role];
    if (!kit || !name) return undefined;
    try { return fs.readFileSync(path.join(kit, 'skills', name, 'SKILL.md'), 'utf8'); } catch { return undefined; }
  }

  mcpConfig(): Record<string, unknown> | undefined {
    const kit = this.cfg.paths.skillsKit;
    const server = kit && path.join(kit, 'mcp', 'feat-map', 'server.mjs');
    return server && fs.existsSync(server) ? { 'feat-map': { command: 'node', args: [server] } } : undefined;
  }

  /** Local repo folder: REPOS (slug) or <REPOS_ROOT>/<name>. */
  resolveRepoPath(repoName: string): string | undefined {
    const name = repoName.split('/').pop()!;
    const mapped = this.cfg.paths.repos.find(r => r.slug.toLowerCase() === name.toLowerCase());
    if (mapped && fs.existsSync(mapped.path)) return mapped.path;
    const guess = path.join(this.cfg.paths.reposRoot, name);
    return fs.existsSync(path.join(guess, '.git')) ? guess : undefined;
  }

  async checkLimits(): Promise<void> {
    await this.store.connect();
    const today = await this.runs.countSince(startOfLocalDay(Date.now(), this.cfg.team.tzOffsetMin));
    const reason = limitReason({ running: this.active.size, maxConcurrent: this.cfg.limits.maxConcurrent, today, maxDaily: this.cfg.limits.maxDailyRuns });
    if (reason) throw Object.assign(new Error(reason), { statusCode: 429 });
  }

  async featContext(query: string, repo: string): Promise<string | undefined> {
    const { hits } = await this.featMaps.search(query, { repo, limit: 3 });
    if (!hits.length) return undefined;
    return hits.map(h => `## ${h.pack.map}:${h.pack.id} — ${h.pack.title}\n${this.mask(this.featMaps.readPack(h.pack).slice(0, 6000)).text}`).join('\n\n');
  }

  requireGh(): GitHubClient {
    if (!this.gh) throw Object.assign(new Error('GitHub not configured'), { statusCode: 503 });
    return this.gh;
  }

  async needStore(): Promise<void> {
    if (!this.store.configured) throw Object.assign(new Error('storage is off (STORAGE=none)'), { statusCode: 503 });
    await this.store.connect();
  }

  // Live log: buffers and writes every second (masked).
  private buffers = new Map<string, RunLogEntry[]>();
  private timers = new Map<string, NodeJS.Timeout>();
  logger(id: string) {
    return (e: RunEvent) => {
      const text = e.type === 'text' ? e.text : e.type === 'tool' ? `${e.name} ${e.input}` : e.type === 'tool_result' ? `${e.ok ? '✓' : '✗'} ${e.text}`
        : e.type === 'denied' ? `negado: ${e.name}` : e.type === 'stderr' ? e.text : `start ${e.model ?? ''}`;
      const list = this.buffers.get(id) ?? [];
      list.push({ at: new Date(), type: e.type, text: this.mask(text).text });
      this.buffers.set(id, list);
      if (!this.timers.has(id)) this.timers.set(id, setTimeout(() => void this.flush(id), 1000));
    };
  }
  async flush(id: string): Promise<void> {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const entries = this.buffers.get(id) ?? [];
    this.buffers.delete(id);
    await this.runs.appendLog(id, entries).catch(() => undefined);
  }

  /** Runs the agent and calls `done` when it ends (live log, cancellation and active-run count). */
  launch(id: string, spec: Parameters<typeof runClaude>[0], done: (r: RunResult) => Promise<void>): void {
    const handle = runClaude(spec, this.logger(id));
    this.active.set(id, handle);
    void handle.promise.then(async (r) => {
      this.active.delete(id);
      await this.flush(id);
      await done(r);
    }).catch(e => this.log.error({ err: (e as Error).message }, 'failed to finish run'));
  }

  cancel(id: string): boolean {
    const h = this.active.get(id);
    if (!h) return false;
    h.cancel();
    return true;
  }
}
