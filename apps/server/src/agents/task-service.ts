// End-to-end task: read-only plan → approval → implementation in an isolated worktree →
// independent verification → draft PR only on click.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { v2 } from '../legacy/v2.js';
import { execCmd } from '../util/exec.js';
import { ALWAYS_DENIED, type AgentContext } from './context.js';
import type { RunDoc, TaskState } from './runs-repo.js';
import {
  buildImplementPrompt, buildPlanPrompt, buildPrBody, implementationTools, parseImplementation, parseIssueUrl, parsePlan,
  PLAN_TOOLS, splitCommand, TASK_PROMPT_VERSION, taskBranch, type IssueInput,
} from './task.js';
import { commitLeftovers, commitsAhead, createWorktree, pushBranch, removeWorktree, repoInstructions } from './worktree.js';

export class TaskService {
  constructor(private readonly ctx: AgentContext) {}

  private async fetchIssue(url: string): Promise<IssueInput & { owner: string; repo: string; number: number }> {
    const ref = parseIssueUrl(url);
    if (!ref) throw Object.assign(new Error('invalid issue URL'), { statusCode: 400 });
    const data = await this.ctx.requireGh().rest('GET', `/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`,
      z.object({ title: z.string(), body: z.string().nullable().optional(), pull_request: z.unknown().optional() }));
    if (data.pull_request) throw Object.assign(new Error('this is a PR, not an issue'), { statusCode: 400 });
    return { ...ref, url, title: this.ctx.mask(data.title).text, body: this.ctx.mask((data.body ?? '').slice(0, 20_000)).text };
  }

  private repoPathOf(repo: string): string {
    const p = this.ctx.resolveRepoPath(repo);
    if (!p) throw Object.assign(new Error(`local clone of ${repo} not found (REPOS or REPOS_ROOT)`), { statusCode: 404 });
    return p;
  }

  /** Planning prompt preview (the Tech Lead can edit it before starting). */
  async previewTask(issueUrl: string) {
    return this.taskPreviewFor(await this.fetchIssue(issueUrl));
  }

  private async taskPreviewFor(issue: Awaited<ReturnType<TaskService['fetchIssue']>>) {
    const repoPath = this.repoPathOf(issue.repo);
    const { hits } = await this.ctx.featMaps.search(`${issue.title} ${issue.repo}`, { repo: issue.repo, limit: 3 });
    const ctx = await this.ctx.featContext(`${issue.title} ${issue.repo}`, issue.repo);
    const raw = buildPlanPrompt({ issue, featContext: ctx, repoInstructions: repoInstructions(repoPath), lang: this.ctx.cfg.contentLang });
    const m = this.ctx.mask(raw);
    return {
      prompt: m.text, masked: m.total, features: hits.map(h => `${h.pack.map}:${h.pack.id}`),
      repo: `${issue.owner}/${issue.repo}`, repoPath, branch: taskBranch(issue.number, issue.title),
      verify: this.verifyCommand(issue.repo) ?? null, title: issue.title,
    };
  }

  private verifyCommand(repo: string): string | undefined {
    const name = repo.split('/').pop()!.toLowerCase();
    return this.ctx.cfg.tasks.verify.find(v => v.repo.toLowerCase() === name || v.repo.toLowerCase() === repo.toLowerCase())?.command;
  }

  /** Stage 1: creates the worktree and runs the agent read-only to propose a plan. */
  async startTask(input: { issueUrl: string; prompt?: string | undefined }): Promise<{ id: string }> {
    await this.ctx.checkLimits();
    const issue = await this.fetchIssue(input.issueUrl);
    const preview = await this.taskPreviewFor(issue);
    const masked = this.ctx.mask(input.prompt ?? preview.prompt);
    const model = this.ctx.cfg.agentModels.task;
    const worktree = path.join(this.ctx.cfg.paths.worktrees, `${issue.repo}-${issue.number}-${Date.now().toString(36)}`);
    const { base } = await createWorktree(preview.repoPath, worktree, preview.branch);
    const task: TaskState = {
      phase: 'planning', issueUrl: input.issueUrl, issueTitle: issue.title, issueBody: issue.body,
      repo: preview.repo, repoPath: preview.repoPath, worktree, branch: preview.branch, base,
    };
    const id = await this.ctx.runs.create({
      kind: 'task', engine: 'claude', itemKey: `gh:${issue.owner}/${issue.repo}#${issue.number}`,
      title: `#${issue.number} ${issue.title}`, target: { issueUrl: input.issueUrl, repo: preview.repo },
      status: 'running', model, promptMasked: masked.text, maskedCount: masked.total, cwd: worktree, startedAt: new Date(),
      log: [], actions: [], promptVersion: `${TASK_PROMPT_VERSION} · ${model}`,
      promptEdited: !!input.prompt && input.prompt.trim() !== preview.prompt.trim(), task,
    });
    this.ctx.launch(id, {
      prompt: masked.text, cwd: worktree, model, tools: PLAN_TOOLS.tools, allowedTools: PLAN_TOOLS.allowed,
      disallowedTools: [...ALWAYS_DENIED, ...PLAN_TOOLS.denied], mcpConfig: this.ctx.mcpConfig(), timeoutMs: this.ctx.cfg.limits.timeoutMin * 60_000,
    }, async (r) => {
      const plan = r.ok ? parsePlan(r.resultText) : undefined;
      if (plan?.ok) {
        await this.ctx.runs.patchTask(id, { phase: 'awaiting_approval', plan: plan.value }, { status: 'done', endedAt: new Date(), ...(r.usage ? { usage: r.usage } : {}) });
      } else {
        const error = this.ctx.mask(r.error ?? (plan && !plan.ok ? plan.error : 'failed')).text;
        await this.ctx.runs.patchTask(id, { phase: 'failed', error }, { status: r.timedOut ? 'timeout' : r.cancelled ? 'cancelled' : 'failed', endedAt: new Date(), result: { error, text: this.ctx.mask(r.resultText).text.slice(0, 20_000) }, ...(r.usage ? { usage: r.usage } : {}) });
      }
    });
    return { id };
  }

  private async getTask(id: string, phases: TaskState['phase'][]): Promise<RunDoc & { task: TaskState }> {
    const run = await this.ctx.runs.get(id);
    if (!run || run.kind !== 'task' || !run.task) throw Object.assign(new Error('task not found'), { statusCode: 404 });
    if (!phases.includes(run.task.phase)) throw Object.assign(new Error(`the task is in "${run.task.phase}"`), { statusCode: 409 });
    return run as RunDoc & { task: TaskState };
  }

  /** Stage 2: plan approved → implementation in the worktree, then independent verification. */
  async approveTask(id: string, notes?: string): Promise<void> {
    const run = await this.getTask(id, ['awaiting_approval']);
    if (this.ctx.active.size >= this.ctx.cfg.limits.maxConcurrent) throw Object.assign(new Error('concurrent run limit reached'), { statusCode: 429 });
    const t = run.task;
    const cleanNotes = notes?.trim() ? this.ctx.mask(notes.trim().slice(0, 4000)).text : undefined;
    const prompt = this.ctx.mask(buildImplementPrompt({
      issue: { url: t.issueUrl, title: t.issueTitle, body: t.issueBody ?? '' }, plan: t.plan!, notes: cleanNotes, testCommands: this.ctx.cfg.tasks.testCommands, lang: this.ctx.cfg.contentLang,
    })).text;
    await this.ctx.runs.patchTask(id, { phase: 'implementing', approvedAt: new Date(), ...(cleanNotes ? { notes: cleanNotes } : {}) }, { status: 'running' });
    await this.ctx.runs.appendLog(id, [{ at: new Date(), type: 'start', text: 'plan approved — implementation' }]);
    const tools = implementationTools(this.ctx.cfg.tasks.testCommands);
    this.ctx.launch(id, {
      prompt, cwd: t.worktree, model: run.model, tools: tools.tools, allowedTools: tools.allowed,
      disallowedTools: [...ALWAYS_DENIED, ...tools.denied], timeoutMs: this.ctx.cfg.limits.timeoutMin * 60_000,
    }, async (r) => {
      const impl = r.ok ? parseImplementation(r.resultText) : undefined;
      const number = Number(t.issueUrl.split('/').pop());
      await commitLeftovers(t.worktree, `${t.issueTitle} (#${number})`);
      const ahead = await commitsAhead(t.worktree, t.base);
      const usage = r.usage ? { usage: this.sumUsage(run.usage, r.usage) } : {};
      if (!impl?.ok || ahead === 0) {
        const error = this.ctx.mask(ahead === 0 && r.ok ? 'the agent made no changes' : r.error ?? (impl && !impl.ok ? impl.error : 'failed')).text;
        await this.ctx.runs.patchTask(id, { phase: 'failed', error }, { status: r.timedOut ? 'timeout' : r.cancelled ? 'cancelled' : 'failed', endedAt: new Date(), ...usage });
        return;
      }
      const verify = this.verifyCommand(t.repo);
      await this.ctx.runs.patchTask(id, { implementation: impl.value, phase: verify ? 'verifying' : 'ready' }, usage);
      if (verify) {
        const started = Date.now();
        const [cmd, args] = splitCommand(verify);
        const v = await execCmd(cmd, args, { cwd: t.worktree, timeoutMs: this.ctx.cfg.limits.timeoutMin * 60_000 });
        const output = this.ctx.mask(`${v.stdout}
${v.stderr}`.trim().slice(-6000)).text;
        await this.ctx.runs.patchTask(id, { phase: 'ready', verify: { command: verify, ok: v.ok, code: v.code, output, durationMs: Date.now() - started } });
      }
      await this.ctx.runs.finish(id, { status: 'done' });
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

  /** Stage 3 (only on click): push the branch and open a draft PR on GitHub. */
  async openTaskPr(id: string): Promise<{ url: string }> {
    const run = await this.getTask(id, ['ready']);
    const t = run.task;
    const ref = parseIssueUrl(t.issueUrl)!;
    const gh = this.ctx.requireGh();
    await pushBranch(t.worktree, t.branch);
    const pr = await gh.rest('POST', `/repos/${ref.owner}/${ref.repo}/pulls`, z.object({ html_url: z.string() }), {
      title: t.issueTitle, head: t.branch, base: t.base.replace(/^origin\//, ''), draft: true,
      body: buildPrBody({ issueNumber: ref.number, plan: t.plan, impl: t.implementation, verify: t.verify, lang: this.ctx.cfg.contentLang }),
    });
    await this.ctx.runs.patchTask(id, { phase: 'pr_opened', prUrl: pr.html_url });
    await this.ctx.runs.addAction(id, { type: 'draft_pr', at: new Date(), ok: true, detail: pr.html_url });
    return { url: pr.html_url };
  }

  /** Descarta a tarefa: para o agente, remove a worktree e a branch local. */
  async discardTask(id: string): Promise<void> {
    const run = await this.getTask(id, ['planning', 'awaiting_approval', 'implementing', 'verifying', 'ready', 'failed']);
    this.ctx.cancel(id);
    await removeWorktree(run.task.repoPath, run.task.worktree, run.task.branch);
    await this.ctx.runs.patchTask(id, { phase: 'discarded' }, run.status === 'running' ? { status: 'cancelled', endedAt: new Date() } : {});
    await this.ctx.runs.addAction(id, { type: 'discard', at: new Date(), ok: true });
  }

  async taskDiff(id: string) {
    const run = await this.getTask(id, ['implementing', 'verifying', 'ready', 'pr_opened', 'failed']);
    if (!fs.existsSync(run.task.worktree)) throw Object.assign(new Error('the task worktree no longer exists'), { statusCode: 410 });
    return (await v2.git.diffSummary(run.task.worktree)) ?? { error: 'not a git repository' };
  }

  async taskPatch(id: string, file?: string): Promise<string> {
    const run = await this.getTask(id, ['implementing', 'verifying', 'ready', 'pr_opened', 'failed']);
    return v2.git.diffPatch(run.task.worktree, file);
  }
}
