// Orquestra as execuções de agentes disparadas pelo painel.
// Nada sai da máquina sem clique: o agente só lê (review) e a review PENDING é um passo separado.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { FeatMapRegistry } from '../featmap/registry.js';
import type { MaskResult } from '../privacy/mask.js';
import type { GitHubClient } from '../sources/github.js';
import type { PainelStore } from '../store/mongo.js';
import { execCmd } from '../util/exec.js';
import { v2 } from '../legacy/v2.js';
import { runClaude, type RunEvent, type RunHandle } from './claude-runner.js';
import { limitReason, startOfLocalDay } from './limits.js';
import { buildPendingReview, buildReviewPrompt, parseReviewResult } from './review.js';
import { RunsRepo, type RunLogEntry } from './runs-repo.js';

type Mask = (s: string) => MaskResult;

const PR_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/;
export function parsePrUrl(url: string): { owner: string; repo: string; number: number } | undefined {
  const m = url.match(PR_URL);
  return m ? { owner: m[1]!, repo: m[2]!, number: Number(m[3]) } : undefined;
}

// Review: só leitura. O agente não consegue postar nada (gh api, review, comment, merge e push negados).
const REVIEW_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'];
const REVIEW_ALLOWED = ['Read', 'Grep', 'Glob', 'Bash(gh pr view:*)', 'Bash(gh pr diff:*)', 'Bash(gh pr checks:*)', 'mcp__feat-map'];
const ALWAYS_DENIED = [
  'Bash(gh api:*)', 'Bash(gh pr review:*)', 'Bash(gh pr comment:*)', 'Bash(gh pr merge:*)', 'Bash(gh pr close:*)',
  'Bash(gh pr edit:*)', 'Bash(gh issue:*)', 'Bash(git push:*)', 'Bash(curl:*)', 'Bash(wget:*)', 'WebFetch', 'WebSearch',
];

export class AgentService {
  private readonly runs: RunsRepo;
  private readonly active = new Map<string, RunHandle>();

  constructor(
    private readonly cfg: Config,
    private readonly store: PainelStore,
    private readonly gh: GitHubClient | undefined,
    private readonly featMaps: FeatMapRegistry,
    private readonly mask: Mask,
    private readonly log: FastifyBaseLogger,
  ) {
    this.runs = new RunsRepo(store);
  }

  get running(): number { return this.active.size; }

  async init(): Promise<void> {
    if (!this.store.configured) return;
    await this.store.connect();
    await this.runs.failOrphans();
  }

  private skill(role: 'review' | 'reviewInbox' | 'daily' | 'dailyDigest'): string | undefined {
    const kit = this.cfg.paths.skillsKit;
    const name = this.cfg.skills[role];
    if (!kit || !name) return undefined;
    try { return fs.readFileSync(path.join(kit, 'skills', name, 'SKILL.md'), 'utf8'); } catch { return undefined; }
  }

  private mcpConfig(): Record<string, unknown> | undefined {
    const kit = this.cfg.paths.skillsKit;
    const server = kit && path.join(kit, 'mcp', 'feat-map', 'server.mjs');
    return server && fs.existsSync(server) ? { 'feat-map': { command: 'node', args: [server] } } : undefined;
  }

  /** Pasta local do repo: REPOS (slug) ou <REPOS_ROOT>/<nome>. */
  resolveRepoPath(repoName: string): string | undefined {
    const name = repoName.split('/').pop()!;
    const mapped = this.cfg.paths.repos.find(r => r.slug.toLowerCase() === name.toLowerCase());
    if (mapped && fs.existsSync(mapped.path)) return mapped.path;
    const guess = path.join(this.cfg.paths.reposRoot, name);
    return fs.existsSync(path.join(guess, '.git')) ? guess : undefined;
  }

  private async checkLimits(): Promise<void> {
    await this.store.connect();
    const today = await this.runs.countSince(startOfLocalDay(Date.now(), this.cfg.team.tzOffsetMin));
    const reason = limitReason({ running: this.active.size, maxConcurrent: this.cfg.limits.maxConcurrent, today, maxDaily: this.cfg.limits.maxDailyRuns });
    if (reason) throw Object.assign(new Error(reason), { statusCode: 429 });
  }

  private async featContext(query: string, repo: string): Promise<string | undefined> {
    const { hits } = await this.featMaps.search(query, { repo, limit: 3 });
    if (!hits.length) return undefined;
    return hits.map(h => `## ${h.pack.map}:${h.pack.id} — ${h.pack.title}\n${this.mask(this.featMaps.readPack(h.pack).slice(0, 6000)).text}`).join('\n\n');
  }

  /** Prévia do prompt de review (o Tech Lead pode editar antes de rodar). */
  async previewReview(prUrl: string, title?: string): Promise<{ prompt: string; masked: number; features: string[] }> {
    const pr = parsePrUrl(prUrl);
    if (!pr) throw Object.assign(new Error('URL de PR inválida'), { statusCode: 400 });
    const { hits } = await this.featMaps.search(`${title ?? ''} ${pr.repo}`, { repo: pr.repo, limit: 3 });
    const ctx = await this.featContext(`${title ?? ''} ${pr.repo}`, pr.repo);
    const raw = buildReviewPrompt({ prUrl, skill: this.skill('review'), featContext: ctx });
    const m = this.mask(raw);
    return { prompt: m.text, masked: m.total, features: hits.map(h => `${h.pack.map}:${h.pack.id}`) };
  }

  /** Dispara a review em segundo plano. Devolve o id da execução (painel_sessoes). */
  async startReview(input: { prUrl: string; title?: string | undefined; prompt?: string | undefined }): Promise<{ id: string }> {
    const pr = parsePrUrl(input.prUrl);
    if (!pr) throw Object.assign(new Error('URL de PR inválida'), { statusCode: 400 });
    await this.checkLimits();
    const base = input.prompt ?? (await this.previewReview(input.prUrl, input.title)).prompt;
    const masked = this.mask(base); // o texto editado também passa pelo mascaramento
    const model = this.cfg.agentModels.review;
    const startedAt = new Date();
    const id = await this.runs.create({
      kind: 'review', engine: 'claude', itemKey: `gh:${pr.owner}/${pr.repo}#${pr.number}`,
      title: this.mask(input.title ?? `${pr.repo}#${pr.number}`).text, target: { prUrl: input.prUrl, repo: `${pr.owner}/${pr.repo}` },
      status: 'running', model, promptMasked: masked.text, maskedCount: masked.total, cwd: '', startedAt, log: [], actions: [],
    });
    const cwd = path.join(this.cfg.paths.runs, id);
    await this.runs.appendLog(id, [], { cwd });

    const handle = runClaude({
      prompt: masked.text, cwd, model, tools: REVIEW_TOOLS, allowedTools: REVIEW_ALLOWED, disallowedTools: ALWAYS_DENIED,
      mcpConfig: this.mcpConfig(), timeoutMs: this.cfg.limits.timeoutMin * 60_000,
    }, this.logger(id));
    this.active.set(id, handle);

    void handle.promise.then(async (r) => {
      this.active.delete(id);
      await this.flush(id);
      const parsed = r.ok ? parseReviewResult(r.resultText) : undefined;
      await this.runs.finish(id, {
        status: r.timedOut ? 'timeout' : r.cancelled ? 'cancelled' : r.ok && parsed?.ok ? 'done' : 'failed',
        ...(r.sessionId ? { claudeSessionId: r.sessionId } : {}),
        ...(r.usage ? { usage: r.usage } : {}),
        result: parsed?.ok
          ? { review: parsed.value, text: this.mask(r.resultText).text.slice(0, 20_000) }
          : { error: this.mask(r.error ?? (parsed && !parsed.ok ? parsed.error : 'falhou')).text, text: this.mask(r.resultText).text.slice(0, 20_000) },
      });
    }).catch(e => this.log.error({ err: (e as Error).message }, 'falha ao finalizar execução'));
    return { id };
  }

  // Log ao vivo: acumula e grava a cada segundo (mascarado).
  private buffers = new Map<string, RunLogEntry[]>();
  private timers = new Map<string, NodeJS.Timeout>();
  private logger(id: string) {
    return (e: RunEvent) => {
      const text = e.type === 'text' ? e.text : e.type === 'tool' ? `${e.name} ${e.input}` : e.type === 'tool_result' ? `${e.ok ? '✓' : '✗'} ${e.text}`
        : e.type === 'denied' ? `negado: ${e.name}` : e.type === 'stderr' ? e.text : `início ${e.model ?? ''}`;
      const list = this.buffers.get(id) ?? [];
      list.push({ at: new Date(), type: e.type, text: this.mask(text).text });
      this.buffers.set(id, list);
      if (!this.timers.has(id)) this.timers.set(id, setTimeout(() => void this.flush(id), 1000));
    };
  }
  private async flush(id: string): Promise<void> {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const entries = this.buffers.get(id) ?? [];
    this.buffers.delete(id);
    await this.runs.appendLog(id, entries).catch(() => undefined);
  }

  cancel(id: string): boolean {
    const h = this.active.get(id);
    if (!h) return false;
    h.cancel();
    return true;
  }

  list() { return this.runs.list(); }
  get(id: string) { return this.runs.get(id); }

  /** Cria a review PENDING no GitHub com os achados (só com clique; nunca aprova nem submete). */
  async postPendingReview(id: string): Promise<{ url: string; comments: number; unanchored: number }> {
    if (!this.gh) throw Object.assign(new Error('GitHub não configurado'), { statusCode: 503 });
    const run = await this.runs.get(id);
    const review = run?.result?.review;
    const pr = run?.target.prUrl ? parsePrUrl(run.target.prUrl) : undefined;
    if (!run || !review || !pr) throw Object.assign(new Error('execução sem resultado de review'), { statusCode: 409 });
    if (run.actions.some(a => a.type === 'pending_review' && a.ok)) throw Object.assign(new Error('a review PENDING já foi criada para esta execução'), { statusCode: 409 });

    const base = `/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`;
    const head = await this.gh.rest('GET', base, z.object({ head: z.object({ sha: z.string() }), html_url: z.string() }));
    const files: Array<{ filename: string; patch?: string | undefined }> = [];
    for (let page = 1; page <= 3; page++) {
      const batch = await this.gh.rest('GET', `${base}/files?per_page=100&page=${page}`, z.array(z.object({ filename: z.string(), patch: z.string().optional() })));
      files.push(...batch);
      if (batch.length < 100) break;
    }
    const pending = buildPendingReview(review, files);
    try {
      await this.gh.rest('POST', `${base}/reviews`, z.object({ id: z.number() }).passthrough(), {
        commit_id: head.head.sha, body: pending.body, comments: pending.comments, // sem "event" = PENDING
      });
    } catch (e) {
      await this.runs.addAction(id, { type: 'pending_review', at: new Date(), ok: false, detail: this.mask((e as Error).message).text });
      throw e;
    }
    await this.runs.addAction(id, { type: 'pending_review', at: new Date(), ok: true, detail: `${pending.comments.length} comentários` });
    return { url: head.html_url, comments: pending.comments.length, unanchored: pending.unanchored };
  }

  /** Abre um terminal com o Claude interativo revisando o PR (a sessão aparece no quadro de Agentes). */
  async openReviewInTerminal(prUrl: string): Promise<{ dir: string }> {
    const pr = parsePrUrl(prUrl);
    if (!pr) throw Object.assign(new Error('URL de PR inválida'), { statusCode: 400 });
    const dir = this.resolveRepoPath(pr.repo) ?? (fs.mkdirSync(this.cfg.paths.runs, { recursive: true }), this.cfg.paths.runs);
    const kit = this.cfg.paths.skillsKit;
    const skill = kit && this.cfg.skills.review ? path.join(kit, 'skills', this.cfg.skills.review, 'SKILL.md') : undefined;
    const prompt = `${skill ? `Leia e siga a skill em ${skill}. ` : ''}Revise o PR ${prUrl}. Não poste nada no GitHub sem eu pedir.`;
    return v2.launch.launch({ repo: dir, branch: '', prompt, worktree: false, tool: 'claude' });
  }

  /** Abre o repo no Cursor; a tela copia o comando para colar no chat. */
  async openInCursor(prUrl: string): Promise<{ dir: string; command: string }> {
    const pr = parsePrUrl(prUrl);
    if (!pr) throw Object.assign(new Error('URL de PR inválida'), { statusCode: 400 });
    const dir = this.resolveRepoPath(pr.repo) ?? this.cfg.paths.skillsKit;
    if (!dir) throw Object.assign(new Error(`clone local de ${pr.repo} não encontrado (REPOS ou REPOS_ROOT)`), { statusCode: 404 });
    const r = await execCmd('cursor', [dir], { timeoutMs: 20_000 });
    if (!r.ok) throw Object.assign(new Error('não foi possível abrir o Cursor'), { statusCode: 500 });
    const name = this.cfg.skills.review;
    return { dir, command: name ? `/${name} ${prUrl}` : `Revise o PR ${prUrl}` };
  }
}
