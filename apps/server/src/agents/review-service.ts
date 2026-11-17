// AI PR review: prompt preview, read-only run, judging the findings and a PENDING review on GitHub.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { computeReviewQuality, keptFindingIndexes, type FindingDecision } from '../domain/review-quality.js';
import { v2 } from '../legacy/v2.js';
import { execCmd } from '../util/exec.js';
import { ALWAYS_DENIED, parsePrUrl, REVIEW_ALLOWED, REVIEW_TOOLS, type AgentContext } from './context.js';
import { pick } from '../domain/lang.js';
import { buildPendingReview, buildReviewPrompt, parseReviewResult, REVIEW_PROMPT_VERSION } from './review.js';

export class ReviewService {
  constructor(private readonly ctx: AgentContext) {}

  /** Review prompt preview (the Tech Lead can edit it before running). */
  async previewReview(prUrl: string, title?: string): Promise<{ prompt: string; masked: number; features: string[] }> {
    const pr = parsePrUrl(prUrl);
    if (!pr) throw Object.assign(new Error('invalid PR URL'), { statusCode: 400 });
    const { hits } = await this.ctx.featMaps.search(`${title ?? ''} ${pr.repo}`, { repo: pr.repo, limit: 3 });
    const ctx = await this.ctx.featContext(`${title ?? ''} ${pr.repo}`, pr.repo);
    const raw = buildReviewPrompt({ prUrl, skill: this.ctx.skill('review'), featContext: ctx, lang: this.ctx.cfg.contentLang });
    const m = this.ctx.mask(raw);
    return { prompt: m.text, masked: m.total, features: hits.map(h => `${h.pack.map}:${h.pack.id}`) };
  }
  /** Starts the review in the background. Returns the run id (deck_runs). */
  async startReview(input: { prUrl: string; title?: string | undefined; prompt?: string | undefined; evalCaseId?: string | undefined }): Promise<{ id: string }> {
    const pr = parsePrUrl(input.prUrl);
    if (!pr) throw Object.assign(new Error('invalid PR URL'), { statusCode: 400 });
    await this.ctx.checkLimits();
    const preview = (await this.previewReview(input.prUrl, input.title)).prompt;
    const base = input.prompt ?? preview;
    const masked = this.ctx.mask(base); // the edited text is masked too
    const model = this.ctx.cfg.agentModels.review;
    const startedAt = new Date();
    const id = await this.ctx.runs.create({
      kind: 'review', engine: 'claude', itemKey: `gh:${pr.owner}/${pr.repo}#${pr.number}`,
      title: this.ctx.mask(input.title ?? `${pr.repo}#${pr.number}`).text, target: { prUrl: input.prUrl, repo: `${pr.owner}/${pr.repo}` },
      status: 'running', model, promptMasked: masked.text, maskedCount: masked.total, cwd: '', startedAt, log: [], actions: [],
      promptVersion: this.reviewPromptVersion(model), promptEdited: !!input.prompt && input.prompt.trim() !== preview.trim(),
      ...(input.evalCaseId ? { evalCaseId: input.evalCaseId } : {}),
    });
    const cwd = path.join(this.ctx.cfg.paths.runs, id);
    await this.ctx.runs.appendLog(id, [], { cwd });

    this.ctx.launch(id, {
      prompt: masked.text, cwd, model, tools: REVIEW_TOOLS, allowedTools: REVIEW_ALLOWED, disallowedTools: ALWAYS_DENIED,
      mcpConfig: this.ctx.mcpConfig(), timeoutMs: this.ctx.cfg.limits.timeoutMin * 60_000,
    }, async (r) => {
      const parsed = r.ok ? parseReviewResult(r.resultText) : undefined;
      await this.ctx.runs.finish(id, {
        status: r.timedOut ? 'timeout' : r.cancelled ? 'cancelled' : r.ok && parsed?.ok ? 'done' : 'failed',
        ...(r.sessionId ? { claudeSessionId: r.sessionId } : {}),
        ...(r.usage ? { usage: r.usage } : {}),
        result: parsed?.ok
          ? { review: parsed.value, text: this.ctx.mask(r.resultText).text.slice(0, 20_000) }
          : { error: this.ctx.mask(r.error ?? (parsed && !parsed.ok ? parsed.error : 'failed')).text, text: this.ctx.mask(r.resultText).text.slice(0, 20_000) },
      });
    });
    return { id };
  }
  /** Version = prompt template + review skill + AI model. If any of them changes, precision is measured separately. */
  reviewPromptVersion(model: string): string {
    const skill = this.ctx.skill('review') ?? '';
    const hash = skill ? crypto.createHash('sha256').update(skill).digest('hex').slice(0, 6) : 'sem-skill';
    return `${REVIEW_PROMPT_VERSION} · skill ${hash} · ${model}`;
  }

  /** The Tech Lead's judgment on each finding (keep or discard). */
  async setFindingDecisions(id: string, decisions: FindingDecision[]): Promise<FindingDecision[]> {
    const run = await this.ctx.runs.get(id);
    const total = run?.result?.review?.findings.length;
    if (!run || total === undefined) throw Object.assign(new Error('run has no review result'), { statusCode: 409 });
    if (decisions.length !== total) throw Object.assign(new Error(`expected ${total} decisions`), { statusCode: 400 });
    await this.ctx.runs.setDecisions(id, decisions);
    return decisions;
  }

  /** AI review precision over the last days, by version, severity and repository. */
  async reviewQuality(days: number) {
    if (!this.ctx.store.configured) return computeReviewQuality([], days);
    await this.ctx.store.connect();
    const runs = await this.ctx.runs.reviewsForQuality(new Date(Date.now() - days * 86_400_000));
    return computeReviewQuality(runs.map(r => ({
      startedAt: r.startedAt, promptVersion: r.promptVersion, model: r.model, repo: r.target?.repo,
      findings: r.result?.review?.findings ?? [], decisions: r.findingDecisions,
      costUsd: r.usage?.costUsd, durationMs: r.usage?.durationMs,
    })), days);
  }
  /** Creates the PENDING review on GitHub with the findings (only on click; never approves or submits). */
  async postPendingReview(id: string): Promise<{ url: string; comments: number; unanchored: number }> {
    if (!this.ctx.gh) throw Object.assign(new Error('GitHub not configured'), { statusCode: 503 });
    const run = await this.ctx.runs.get(id);
    const review = run?.result?.review;
    const pr = run?.target.prUrl ? parsePrUrl(run.target.prUrl) : undefined;
    if (!run || !review || !pr) throw Object.assign(new Error('run has no review result'), { statusCode: 409 });
    if (run.evalCaseId) throw Object.assign(new Error('an evaluation run does not become a GitHub review'), { statusCode: 409 });
    if (run.actions.some(a => a.type === 'pending_review' && a.ok)) throw Object.assign(new Error('the PENDING review was already created for this run'), { statusCode: 409 });

    const base = `/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`;
    const head = await this.ctx.gh.rest('GET', base, z.object({ head: z.object({ sha: z.string() }), html_url: z.string() }));
    const files: Array<{ filename: string; patch?: string | undefined }> = [];
    for (let page = 1; page <= 3; page++) {
      const batch = await this.ctx.gh.rest('GET', `${base}/files?per_page=100&page=${page}`, z.array(z.object({ filename: z.string(), patch: z.string().optional() })));
      files.push(...batch);
      if (batch.length < 100) break;
    }
    // Findings the Tech Lead discarded do not go to GitHub.
    const kept = keptFindingIndexes(review.findings.length, run.findingDecisions);
    const pending = buildPendingReview({ ...review, findings: kept.map(i => review.findings[i]!) }, files, this.ctx.cfg.contentLang);
    try {
      await this.ctx.gh.rest('POST', `${base}/reviews`, z.object({ id: z.number() }).passthrough(), {
        commit_id: head.head.sha, body: pending.body, comments: pending.comments, // sem "event" = PENDING
      });
    } catch (e) {
      await this.ctx.runs.addAction(id, { type: 'pending_review', at: new Date(), ok: false, detail: this.ctx.mask((e as Error).message).text });
      throw e;
    }
    await this.ctx.runs.addAction(id, { type: 'pending_review', at: new Date(), ok: true, detail: `${kept.length} of ${review.findings.length} findings · ${pending.comments.length} comments` });
    return { url: head.html_url, comments: pending.comments.length, unanchored: pending.unanchored };
  }

  /** Opens a terminal with interactive Claude reviewing the PR (the session shows up on the Agents board). */
  async openReviewInTerminal(prUrl: string): Promise<{ dir: string }> {
    const pr = parsePrUrl(prUrl);
    if (!pr) throw Object.assign(new Error('invalid PR URL'), { statusCode: 400 });
    const dir = this.ctx.resolveRepoPath(pr.repo) ?? (fs.mkdirSync(this.ctx.cfg.paths.runs, { recursive: true }), this.ctx.cfg.paths.runs);
    const kit = this.ctx.cfg.paths.skillsKit;
    const skill = kit && this.ctx.cfg.skills.review ? path.join(kit, 'skills', this.ctx.cfg.skills.review, 'SKILL.md') : undefined;
    const lang = this.ctx.cfg.contentLang;
    const prompt = pick(lang, `${skill ? `Read and follow the skill at ${skill}. ` : ''}Review the PR ${prUrl}. Do not post anything on GitHub unless I ask.`,
      `${skill ? `Leia e siga a skill em ${skill}. ` : ''}Revise o PR ${prUrl}. Não poste nada no GitHub sem eu pedir.`);
    return v2.launch.launch({ repo: dir, branch: '', prompt, worktree: false, tool: 'claude' });
  }

  /** Opens the repo in Cursor; the screen copies the command to paste in the chat. */
  async openInCursor(prUrl: string): Promise<{ dir: string; command: string }> {
    const pr = parsePrUrl(prUrl);
    if (!pr) throw Object.assign(new Error('invalid PR URL'), { statusCode: 400 });
    const dir = this.ctx.resolveRepoPath(pr.repo) ?? this.ctx.cfg.paths.skillsKit;
    if (!dir) throw Object.assign(new Error(`local clone of ${pr.repo} not found (REPOS or REPOS_ROOT)`), { statusCode: 404 });
    const r = await execCmd('cursor', [dir], { timeoutMs: 20_000 });
    if (!r.ok) throw Object.assign(new Error('could not open Cursor'), { statusCode: 500 });
    const name = this.ctx.cfg.skills.review;
    return { dir, command: name ? `/${name} ${prUrl}` : pick(this.ctx.cfg.contentLang, `Review the PR ${prUrl}`, `Revise o PR ${prUrl}`) };
  }
}
