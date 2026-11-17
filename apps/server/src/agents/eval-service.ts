// Fixed evaluation set: cases with known problems to measure what the AI review misses.
import { recallByVersion, type EvalCase } from '../domain/review-eval.js';
import { DocRepo } from '../store/doc-repo.js';
import { parsePrUrl, type AgentContext } from './context.js';
import type { ReviewService } from './review-service.js';

export class EvalService {
  constructor(private readonly ctx: AgentContext, private readonly reviews: ReviewService) {}

    private get evalCases() { return new DocRepo<EvalCase>(this.ctx.store, 'deck_evals'); }
  evalState: { running: boolean; total: number; done: number; current?: string | undefined; error?: string | undefined; startedAt?: Date | undefined } = { running: false, total: 0, done: 0 };

  async listEvalCases(): Promise<Array<EvalCase & { _id: string }>> {
    await this.ctx.needStore();
    return (await this.evalCases.list({}, { createdAt: 1 }, 500)).map(c => ({ ...c, _id: String(c._id) }));
  }

  private maskCase<T extends Partial<EvalCase>>(c: T): T {
    const m = (s: string) => this.ctx.mask(s).text;
    return { ...c, ...(c.name ? { name: m(c.name) } : {}), ...(c.expected ? { expected: c.expected.map(e => ({ ...e, keywords: e.keywords.map(m), ...(e.note ? { note: m(e.note) } : {}) })) } : {}) };
  }

  async saveEvalCase(id: string | undefined, input: Omit<EvalCase, '_id' | 'createdAt'>): Promise<{ id: string }> {
    await this.ctx.needStore();
    if (!parsePrUrl(input.prUrl)) throw Object.assign(new Error('invalid PR URL'), { statusCode: 400 });
    const doc = this.maskCase(input);
    if (id) {
      if (!(await this.evalCases.update(id, doc))) throw Object.assign(new Error('case not found'), { statusCode: 404 });
      return { id };
    }
    return { id: await this.evalCases.create({ ...doc, createdAt: new Date() }) };
  }

  async deleteEvalCase(id: string): Promise<boolean> {
    await this.ctx.needStore();
    return this.evalCases.remove(id);
  }

  async evalSummary() {
    await this.ctx.needStore();
    const [cases, runs] = await Promise.all([this.listEvalCases(), this.ctx.runs.evalRuns()]);
    return {
      currentVersion: this.reviews.reviewPromptVersion(this.ctx.cfg.agentModels.review),
      state: this.evalState,
      cases,
      versions: recallByVersion(cases, runs.map(r => ({
        caseId: r.evalCaseId!, promptVersion: r.promptVersion, startedAt: r.startedAt, status: r.status,
        findings: r.result?.review?.findings, costUsd: r.usage?.costUsd,
      }))),
    };
  }

  /** Runs the current review on each case, one at a time (respects the cost limits). */
  async runEvals(ids?: string[]): Promise<{ total: number }> {
    if (this.evalState.running) throw Object.assign(new Error('the evaluation is already running'), { statusCode: 409 });
    const all = await this.listEvalCases();
    const cases = ids?.length ? all.filter(c => ids.includes(c._id)) : all;
    if (!cases.length) throw Object.assign(new Error('no case to run'), { statusCode: 400 });
    this.evalState = { running: true, total: cases.length, done: 0, startedAt: new Date() };
    void (async () => {
      for (const c of cases) {
        this.evalState.current = c.name;
        try {
          const { id } = await this.reviews.startReview({ prUrl: c.prUrl, title: `[eval] ${c.name}`, evalCaseId: c._id });
          await this.waitFinished(id);
          this.evalState.done++;
        } catch (e) {
          this.evalState.error = this.ctx.mask((e as Error).message).text;
          break;
        }
      }
      this.evalState = { ...this.evalState, running: false, current: undefined };
    })();
    return { total: cases.length };
  }

  private async waitFinished(id: string): Promise<void> {
    await this.ctx.active.get(id)?.promise.catch(() => undefined);
    for (let i = 0; i < 60; i++) {
      const r = await this.ctx.runs.get(id);
      if (r && r.status !== 'running') return;
      await new Promise(res => setTimeout(res, 500));
    }
  }
}
