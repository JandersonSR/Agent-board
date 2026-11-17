// Fachada das execuções de agentes usada pelas rotas. Nada sai da máquina sem clique:
// o agente só lê (review), a review PENDING e o PR em rascunho são passos separados.
// A lógica fica em context.ts (comum), review-service.ts, task-service.ts e eval-service.ts.
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { FeatMapRegistry } from '../featmap/registry.js';
import type { MaskResult } from '../privacy/mask.js';
import type { GitHubClient } from '../sources/github.js';
import type { PainelStore } from '../store/mongo.js';
import { AgentContext, type Mask } from './context.js';
import { EvalService } from './eval-service.js';
import { ReviewService } from './review-service.js';
import { TaskService } from './task-service.js';

export { parsePrUrl } from './context.js';

export class AgentService {
  private readonly ctx: AgentContext;
  readonly reviews: ReviewService;
  readonly tasks: TaskService;
  readonly evals: EvalService;

  constructor(cfg: Config, store: PainelStore, gh: GitHubClient | undefined, featMaps: FeatMapRegistry, mask: Mask, log: FastifyBaseLogger) {
    this.ctx = new AgentContext(cfg, store, gh, featMaps, mask, log);
    this.reviews = new ReviewService(this.ctx);
    this.tasks = new TaskService(this.ctx);
    this.evals = new EvalService(this.ctx, this.reviews);
  }

  get running(): number { return this.ctx.active.size; }

  async init(): Promise<void> {
    if (!this.ctx.store.configured) return;
    await this.ctx.store.connect();
    await this.ctx.runs.failOrphans();
  }

  resolveRepoPath(repoName: string) { return this.ctx.resolveRepoPath(repoName); }
  cancel(id: string) { return this.ctx.cancel(id); }
  list() { return this.ctx.runs.list(); }
  get(id: string) { return this.ctx.runs.get(id); }

  // Review
  previewReview(...a: Parameters<ReviewService['previewReview']>) { return this.reviews.previewReview(...a); }
  startReview(...a: Parameters<ReviewService['startReview']>) { return this.reviews.startReview(...a); }
  reviewPromptVersion(model: string) { return this.reviews.reviewPromptVersion(model); }
  setFindingDecisions(...a: Parameters<ReviewService['setFindingDecisions']>) { return this.reviews.setFindingDecisions(...a); }
  reviewQuality(days: number) { return this.reviews.reviewQuality(days); }
  postPendingReview(id: string) { return this.reviews.postPendingReview(id); }
  openReviewInTerminal(prUrl: string) { return this.reviews.openReviewInTerminal(prUrl); }
  openInCursor(prUrl: string) { return this.reviews.openInCursor(prUrl); }

  // Tarefas
  previewTask(issueUrl: string) { return this.tasks.previewTask(issueUrl); }
  startTask(...a: Parameters<TaskService['startTask']>) { return this.tasks.startTask(...a); }
  approveTask(id: string, notes?: string) { return this.tasks.approveTask(id, notes); }
  openTaskPr(id: string) { return this.tasks.openTaskPr(id); }
  discardTask(id: string) { return this.tasks.discardTask(id); }
  taskDiff(id: string) { return this.tasks.taskDiff(id); }
  taskPatch(id: string, file?: string) { return this.tasks.taskPatch(id, file); }

  // Avaliação
  get evalState() { return this.evals.evalState; }
  listEvalCases() { return this.evals.listEvalCases(); }
  saveEvalCase(...a: Parameters<EvalService['saveEvalCase']>) { return this.evals.saveEvalCase(...a); }
  deleteEvalCase(id: string) { return this.evals.deleteEvalCase(id); }
  evalSummary() { return this.evals.evalSummary(); }
  runEvals(ids?: string[]) { return this.evals.runEvals(ids); }
}
