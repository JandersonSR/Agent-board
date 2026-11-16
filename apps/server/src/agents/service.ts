// Orquestra as execuções de agentes disparadas pelo painel.
// Nada sai da máquina sem clique: o agente só lê (review) e a review PENDING é um passo separado.
import crypto from 'node:crypto';
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
import { computeReviewQuality, keptFindingIndexes, type FindingDecision } from '../domain/review-quality.js';
import { buildPendingReview, buildReviewPrompt, parseReviewResult, REVIEW_PROMPT_VERSION } from './review.js';
import { RunsRepo, type RunDoc, type RunLogEntry, type TaskState } from './runs-repo.js';
import {
  buildImplementPrompt, buildPlanPrompt, buildPrBody, implementationTools, parseImplementation, parseIssueUrl, parsePlan,
  PLAN_TOOLS, splitCommand, TASK_PROMPT_VERSION, taskBranch, type IssueInput,
} from './task.js';
import { commitLeftovers, commitsAhead, createWorktree, pushBranch, removeWorktree, repoInstructions } from './worktree.js';

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
    const preview = (await this.previewReview(input.prUrl, input.title)).prompt;
    const base = input.prompt ?? preview;
    const masked = this.mask(base); // o texto editado também passa pelo mascaramento
    const model = this.cfg.agentModels.review;
    const startedAt = new Date();
    const id = await this.runs.create({
      kind: 'review', engine: 'claude', itemKey: `gh:${pr.owner}/${pr.repo}#${pr.number}`,
      title: this.mask(input.title ?? `${pr.repo}#${pr.number}`).text, target: { prUrl: input.prUrl, repo: `${pr.owner}/${pr.repo}` },
      status: 'running', model, promptMasked: masked.text, maskedCount: masked.total, cwd: '', startedAt, log: [], actions: [],
      promptVersion: this.reviewPromptVersion(model), promptEdited: !!input.prompt && input.prompt.trim() !== preview.trim(),
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

  /** Versão = modelo do prompt + skill de review + modelo de IA. Mudou qualquer um, a precisão é medida à parte. */
  reviewPromptVersion(model: string): string {
    const skill = this.skill('review') ?? '';
    const hash = skill ? crypto.createHash('sha256').update(skill).digest('hex').slice(0, 6) : 'sem-skill';
    return `${REVIEW_PROMPT_VERSION} · skill ${hash} · ${model}`;
  }

  /** Julgamento do Tech Lead sobre cada achado (manter ou descartar). */
  async setFindingDecisions(id: string, decisions: FindingDecision[]): Promise<FindingDecision[]> {
    const run = await this.runs.get(id);
    const total = run?.result?.review?.findings.length;
    if (!run || total === undefined) throw Object.assign(new Error('execução sem resultado de review'), { statusCode: 409 });
    if (decisions.length !== total) throw Object.assign(new Error(`esperava ${total} decisões`), { statusCode: 400 });
    await this.runs.setDecisions(id, decisions);
    return decisions;
  }

  /** Precisão da review por IA nos últimos dias, por versão, severidade e repositório. */
  async reviewQuality(days: number) {
    if (!this.store.configured) return computeReviewQuality([], days);
    await this.store.connect();
    const runs = await this.runs.reviewsForQuality(new Date(Date.now() - days * 86_400_000));
    return computeReviewQuality(runs.map(r => ({
      startedAt: r.startedAt, promptVersion: r.promptVersion, model: r.model, repo: r.target?.repo,
      findings: r.result?.review?.findings ?? [], decisions: r.findingDecisions,
      costUsd: r.usage?.costUsd, durationMs: r.usage?.durationMs,
    })), days);
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

  // ---------- Tarefas de ponta a ponta ----------

  private requireGh(): GitHubClient {
    if (!this.gh) throw Object.assign(new Error('GitHub não configurado'), { statusCode: 503 });
    return this.gh;
  }

  private async fetchIssue(url: string): Promise<IssueInput & { owner: string; repo: string; number: number }> {
    const ref = parseIssueUrl(url);
    if (!ref) throw Object.assign(new Error('URL de issue inválida'), { statusCode: 400 });
    const data = await this.requireGh().rest('GET', `/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`,
      z.object({ title: z.string(), body: z.string().nullable().optional(), pull_request: z.unknown().optional() }));
    if (data.pull_request) throw Object.assign(new Error('isto é um PR, não uma issue'), { statusCode: 400 });
    return { ...ref, url, title: this.mask(data.title).text, body: this.mask((data.body ?? '').slice(0, 20_000)).text };
  }

  private repoPathOf(repo: string): string {
    const p = this.resolveRepoPath(repo);
    if (!p) throw Object.assign(new Error(`clone local de ${repo} não encontrado (REPOS ou REPOS_ROOT)`), { statusCode: 404 });
    return p;
  }

  /** Prévia do prompt de planejamento (o Tech Lead pode editar antes de começar). */
  async previewTask(issueUrl: string) {
    return this.taskPreviewFor(await this.fetchIssue(issueUrl));
  }

  private async taskPreviewFor(issue: Awaited<ReturnType<AgentService['fetchIssue']>>) {
    const repoPath = this.repoPathOf(issue.repo);
    const { hits } = await this.featMaps.search(`${issue.title} ${issue.repo}`, { repo: issue.repo, limit: 3 });
    const ctx = await this.featContext(`${issue.title} ${issue.repo}`, issue.repo);
    const raw = buildPlanPrompt({ issue, featContext: ctx, repoInstructions: repoInstructions(repoPath) });
    const m = this.mask(raw);
    return {
      prompt: m.text, masked: m.total, features: hits.map(h => `${h.pack.map}:${h.pack.id}`),
      repo: `${issue.owner}/${issue.repo}`, repoPath, branch: taskBranch(issue.number, issue.title),
      verify: this.verifyCommand(issue.repo) ?? null, title: issue.title,
    };
  }

  private verifyCommand(repo: string): string | undefined {
    const name = repo.split('/').pop()!.toLowerCase();
    return this.cfg.tasks.verify.find(v => v.repo.toLowerCase() === name || v.repo.toLowerCase() === repo.toLowerCase())?.command;
  }

  /** Etapa 1: cria a worktree e roda o agente só com leitura para propor um plano. */
  async startTask(input: { issueUrl: string; prompt?: string | undefined }): Promise<{ id: string }> {
    await this.checkLimits();
    const issue = await this.fetchIssue(input.issueUrl);
    const preview = await this.taskPreviewFor(issue);
    const masked = this.mask(input.prompt ?? preview.prompt);
    const model = this.cfg.agentModels.task;
    const worktree = path.join(this.cfg.paths.worktrees, `${issue.repo}-${issue.number}-${Date.now().toString(36)}`);
    const { base } = await createWorktree(preview.repoPath, worktree, preview.branch);
    const task: TaskState = {
      phase: 'planning', issueUrl: input.issueUrl, issueTitle: issue.title, issueBody: issue.body,
      repo: preview.repo, repoPath: preview.repoPath, worktree, branch: preview.branch, base,
    };
    const id = await this.runs.create({
      kind: 'task', engine: 'claude', itemKey: `gh:${issue.owner}/${issue.repo}#${issue.number}`,
      title: `#${issue.number} ${issue.title}`, target: { issueUrl: input.issueUrl, repo: preview.repo },
      status: 'running', model, promptMasked: masked.text, maskedCount: masked.total, cwd: worktree, startedAt: new Date(),
      log: [], actions: [], promptVersion: `${TASK_PROMPT_VERSION} · ${model}`,
      promptEdited: !!input.prompt && input.prompt.trim() !== preview.prompt.trim(), task,
    });
    this.launchPhase(id, {
      prompt: masked.text, cwd: worktree, model, tools: PLAN_TOOLS.tools, allowedTools: PLAN_TOOLS.allowed,
      disallowedTools: [...ALWAYS_DENIED, ...PLAN_TOOLS.denied], mcpConfig: this.mcpConfig(), timeoutMs: this.cfg.limits.timeoutMin * 60_000,
    }, async (r) => {
      const plan = r.ok ? parsePlan(r.resultText) : undefined;
      if (plan?.ok) {
        await this.runs.patchTask(id, { phase: 'awaiting_approval', plan: plan.value }, { status: 'done', endedAt: new Date(), ...(r.usage ? { usage: r.usage } : {}) });
      } else {
        const error = this.mask(r.error ?? (plan && !plan.ok ? plan.error : 'falhou')).text;
        await this.runs.patchTask(id, { phase: 'failed', error }, { status: r.timedOut ? 'timeout' : r.cancelled ? 'cancelled' : 'failed', endedAt: new Date(), result: { error, text: this.mask(r.resultText).text.slice(0, 20_000) }, ...(r.usage ? { usage: r.usage } : {}) });
      }
    });
    return { id };
  }

  private async getTask(id: string, phases: TaskState['phase'][]): Promise<RunDoc & { task: TaskState }> {
    const run = await this.runs.get(id);
    if (!run || run.kind !== 'task' || !run.task) throw Object.assign(new Error('tarefa não encontrada'), { statusCode: 404 });
    if (!phases.includes(run.task.phase)) throw Object.assign(new Error(`a tarefa está em "${run.task.phase}"`), { statusCode: 409 });
    return run as RunDoc & { task: TaskState };
  }

  /** Etapa 2: plano aprovado → implementação na worktree, depois verificação independente. */
  async approveTask(id: string, notes?: string): Promise<void> {
    const run = await this.getTask(id, ['awaiting_approval']);
    if (this.active.size >= this.cfg.limits.maxConcurrent) throw Object.assign(new Error('limite de execuções simultâneas atingido'), { statusCode: 429 });
    const t = run.task;
    const cleanNotes = notes?.trim() ? this.mask(notes.trim().slice(0, 4000)).text : undefined;
    const prompt = this.mask(buildImplementPrompt({
      issue: { url: t.issueUrl, title: t.issueTitle, body: t.issueBody ?? '' }, plan: t.plan!, notes: cleanNotes, testCommands: this.cfg.tasks.testCommands,
    })).text;
    await this.runs.patchTask(id, { phase: 'implementing', approvedAt: new Date(), ...(cleanNotes ? { notes: cleanNotes } : {}) }, { status: 'running' });
    await this.runs.appendLog(id, [{ at: new Date(), type: 'start', text: 'plano aprovado — implementação' }]);
    const tools = implementationTools(this.cfg.tasks.testCommands);
    this.launchPhase(id, {
      prompt, cwd: t.worktree, model: run.model, tools: tools.tools, allowedTools: tools.allowed,
      disallowedTools: [...ALWAYS_DENIED, ...tools.denied], timeoutMs: this.cfg.limits.timeoutMin * 60_000,
    }, async (r) => {
      const impl = r.ok ? parseImplementation(r.resultText) : undefined;
      const number = Number(t.issueUrl.split('/').pop());
      await commitLeftovers(t.worktree, `${t.issueTitle} (#${number})`);
      const ahead = await commitsAhead(t.worktree, t.base);
      const usage = r.usage ? { usage: this.sumUsage(run.usage, r.usage) } : {};
      if (!impl?.ok || ahead === 0) {
        const error = this.mask(ahead === 0 && r.ok ? 'o agente não gerou mudanças' : r.error ?? (impl && !impl.ok ? impl.error : 'falhou')).text;
        await this.runs.patchTask(id, { phase: 'failed', error }, { status: r.timedOut ? 'timeout' : r.cancelled ? 'cancelled' : 'failed', endedAt: new Date(), ...usage });
        return;
      }
      const verify = this.verifyCommand(t.repo);
      await this.runs.patchTask(id, { implementation: impl.value, phase: verify ? 'verifying' : 'ready' }, usage);
      if (verify) {
        const started = Date.now();
        const [cmd, args] = splitCommand(verify);
        const v = await execCmd(cmd, args, { cwd: t.worktree, timeoutMs: this.cfg.limits.timeoutMin * 60_000 });
        const output = this.mask(`${v.stdout}
${v.stderr}`.trim().slice(-6000)).text;
        await this.runs.patchTask(id, { phase: 'ready', verify: { command: verify, ok: v.ok, code: v.code, output, durationMs: Date.now() - started } });
      }
      await this.runs.finish(id, { status: 'done' });
    });
  }

  private sumUsage(a: RunDoc['usage'], b: NonNullable<RunDoc['usage']>): NonNullable<RunDoc['usage']> {
    if (!a) return b;
    return {
      inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens,
      cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens, cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
      costUsd: a.costUsd + b.costUsd, durationMs: a.durationMs + b.durationMs, turns: a.turns + b.turns,
    };
  }

  /** Roda uma etapa do agente e chama `done` ao terminar (log ao vivo, cancelamento e limites iguais à review). */
  private launchPhase(id: string, spec: Parameters<typeof runClaude>[0], done: (r: Awaited<RunHandle['promise']>) => Promise<void>): void {
    const handle = runClaude(spec, this.logger(id));
    this.active.set(id, handle);
    void handle.promise.then(async (r) => {
      this.active.delete(id);
      await this.flush(id);
      await done(r);
    }).catch(e => this.log.error({ err: (e as Error).message }, 'falha ao finalizar etapa da tarefa'));
  }

  /** Etapa 3 (só com clique): push da branch e PR em rascunho no GitHub. */
  async openTaskPr(id: string): Promise<{ url: string }> {
    const run = await this.getTask(id, ['ready']);
    const t = run.task;
    const ref = parseIssueUrl(t.issueUrl)!;
    const gh = this.requireGh();
    await pushBranch(t.worktree, t.branch);
    const pr = await gh.rest('POST', `/repos/${ref.owner}/${ref.repo}/pulls`, z.object({ html_url: z.string() }), {
      title: t.issueTitle, head: t.branch, base: t.base.replace(/^origin\//, ''), draft: true,
      body: buildPrBody({ issueNumber: ref.number, plan: t.plan, impl: t.implementation, verify: t.verify }),
    });
    await this.runs.patchTask(id, { phase: 'pr_opened', prUrl: pr.html_url });
    await this.runs.addAction(id, { type: 'draft_pr', at: new Date(), ok: true, detail: pr.html_url });
    return { url: pr.html_url };
  }

  /** Descarta a tarefa: para o agente, remove a worktree e a branch local. */
  async discardTask(id: string): Promise<void> {
    const run = await this.getTask(id, ['planning', 'awaiting_approval', 'implementing', 'verifying', 'ready', 'failed']);
    this.cancel(id);
    await removeWorktree(run.task.repoPath, run.task.worktree, run.task.branch);
    await this.runs.patchTask(id, { phase: 'discarded' }, run.status === 'running' ? { status: 'cancelled', endedAt: new Date() } : {});
    await this.runs.addAction(id, { type: 'discard', at: new Date(), ok: true });
  }

  async taskDiff(id: string) {
    const run = await this.getTask(id, ['implementing', 'verifying', 'ready', 'pr_opened', 'failed']);
    if (!fs.existsSync(run.task.worktree)) throw Object.assign(new Error('a worktree da tarefa não existe mais'), { statusCode: 410 });
    return (await v2.git.diffSummary(run.task.worktree)) ?? { error: 'não é um repositório git' };
  }

  async taskPatch(id: string, file?: string): Promise<string> {
    const run = await this.getTask(id, ['implementing', 'verifying', 'ready', 'pr_opened', 'failed']);
    return v2.git.diffPatch(run.task.worktree, file);
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
    // Achados descartados pelo Tech Lead não vão para o GitHub.
    const kept = keptFindingIndexes(review.findings.length, run.findingDecisions);
    const pending = buildPendingReview({ ...review, findings: kept.map(i => review.findings[i]!) }, files);
    try {
      await this.gh.rest('POST', `${base}/reviews`, z.object({ id: z.number() }).passthrough(), {
        commit_id: head.head.sha, body: pending.body, comments: pending.comments, // sem "event" = PENDING
      });
    } catch (e) {
      await this.runs.addAction(id, { type: 'pending_review', at: new Date(), ok: false, detail: this.mask((e as Error).message).text });
      throw e;
    }
    await this.runs.addAction(id, { type: 'pending_review', at: new Date(), ok: true, detail: `${kept.length} de ${review.findings.length} achados · ${pending.comments.length} comentários` });
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
