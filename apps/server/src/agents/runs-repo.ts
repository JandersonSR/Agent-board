// painel_sessoes: execuções de agentes disparadas pelo painel (review, tarefa).
// Todo texto que entra aqui já vem mascarado. O log é limitado às últimas 400 entradas.
import { ObjectId } from 'mongodb';
import type { PainelStore } from '../store/mongo.js';
import type { RunUsage } from './claude-runner.js';
import type { FindingDecision } from '../domain/review-quality.js';
import type { ReviewResultT } from './review.js';

export type RunKind = 'review' | 'task';
export type RunStatus = 'running' | 'done' | 'failed' | 'timeout' | 'cancelled';

/** Etapas da tarefa: plano (só leitura) → aprovação → implementação → verificação → PR rascunho. */
export type TaskPhase = 'planning' | 'awaiting_approval' | 'implementing' | 'verifying' | 'ready' | 'pr_opened' | 'discarded' | 'failed';

export interface TaskPlan { summary: string; steps: string[]; files: string[]; tests: string[]; risks: string[]; questions: string[] }
export interface TaskImplementation { summary: string; changes: string[]; testsRun: string[]; testsPassed: boolean | null; followUps: string[] }
export interface TaskVerify { command: string; ok: boolean; code: number | null; output: string; durationMs: number }

export interface TaskState {
  phase: TaskPhase;
  issueUrl: string;
  issueTitle: string;
  issueBody?: string;    // mascarado
  repo: string;          // owner/name
  repoPath: string;      // clone local
  worktree: string;      // worktree isolada da tarefa
  branch: string;
  base: string;          // branch base (ex.: origin/main)
  plan?: TaskPlan;
  notes?: string;        // observações do Tech Lead ao aprovar
  approvedAt?: Date;
  implementation?: TaskImplementation;
  verify?: TaskVerify;
  prUrl?: string;
  error?: string;
}

export interface RunLogEntry { at: Date; type: string; text: string }
export interface RunAction { type: string; at: Date; ok: boolean; detail?: string }

export interface RunDoc {
  _id?: ObjectId;
  kind: RunKind;
  engine: 'claude';
  itemKey: string;
  title: string;
  target: { prUrl?: string; issueUrl?: string; repo?: string };
  status: RunStatus;
  model: string;
  promptMasked: string;
  maskedCount: number;
  cwd: string;
  startedAt: Date;
  endedAt?: Date;
  log: RunLogEntry[];
  result?: { review?: ReviewResultT; text?: string; error?: string };
  usage?: RunUsage;
  claudeSessionId?: string;
  actions: RunAction[];
  /** Versão do prompt (modelo + skill + modelo de IA), para comparar a qualidade entre versões. */
  promptVersion?: string;
  /** O Tech Lead editou o prompt na prévia antes de rodar. */
  promptEdited?: boolean;
  /** Julgamento do Tech Lead para cada achado (mesma ordem de result.review.findings). */
  findingDecisions?: FindingDecision[];
  /** Campos da tarefa de ponta a ponta (kind = 'task'). */
  task?: TaskState;
  /** Review rodada contra um caso do conjunto fixo de avaliação (painel_avaliacoes). Nunca vira review no GitHub. */
  evalCaseId?: string;
}

export class RunsRepo {
  constructor(private readonly store: PainelStore) {}
  private get col() { return this.store.collection<RunDoc>('painel_sessoes'); }

  async create(doc: Omit<RunDoc, '_id'>): Promise<string> {
    const r = await this.col.insertOne(doc as RunDoc);
    return String(r.insertedId);
  }

  async appendLog(id: string, entries: RunLogEntry[], patch: Partial<RunDoc> = {}): Promise<void> {
    if (!entries.length && !Object.keys(patch).length) return;
    await this.col.updateOne({ _id: new ObjectId(id) }, {
      ...(entries.length ? { $push: { log: { $each: entries, $slice: -400 } } } : {}),
      ...(Object.keys(patch).length ? { $set: patch } : {}),
    });
  }

  async finish(id: string, patch: Partial<RunDoc>): Promise<void> {
    await this.col.updateOne({ _id: new ObjectId(id) }, { $set: { ...patch, endedAt: new Date() } });
  }

  async addAction(id: string, action: RunAction): Promise<void> {
    await this.col.updateOne({ _id: new ObjectId(id) }, { $push: { actions: action } });
  }

  async get(id: string): Promise<RunDoc | null> {
    return (await this.col.findOne({ _id: new ObjectId(id) })) as RunDoc | null;
  }

  async list(limit = 50): Promise<RunDoc[]> {
    return (await this.col.find({}, { projection: { log: { $slice: -3 }, promptMasked: 0 } }).sort({ startedAt: -1 }).limit(limit).toArray()) as RunDoc[];
  }

  async setDecisions(id: string, decisions: FindingDecision[]): Promise<void> {
    await this.col.updateOne({ _id: new ObjectId(id) }, { $set: { findingDecisions: decisions } });
  }

  async patchTask(id: string, patch: Partial<TaskState>, extra: Partial<RunDoc> = {}): Promise<void> {
    const set: Record<string, unknown> = { ...extra };
    for (const [k, v] of Object.entries(patch)) set[`task.${k}`] = v;
    if (Object.keys(set).length) await this.col.updateOne({ _id: new ObjectId(id) }, { $set: set });
  }

  /** Reviews concluídas desde uma data, só com o que a medição de qualidade precisa. */
  async reviewsForQuality(since: Date): Promise<RunDoc[]> {
    return (await this.col.find(
      { kind: 'review', status: 'done', startedAt: { $gte: since }, evalCaseId: { $exists: false } },
      { projection: { startedAt: 1, promptVersion: 1, model: 1, 'target.repo': 1, 'result.review.findings.severity': 1, findingDecisions: 1, usage: 1 } },
    ).toArray()) as RunDoc[];
  }

  /** Execuções do conjunto fixo de avaliação, só com o que o recall usa. */
  async evalRuns(): Promise<RunDoc[]> {
    return (await this.col.find(
      { evalCaseId: { $exists: true } },
      { projection: { evalCaseId: 1, promptVersion: 1, startedAt: 1, status: 1, 'result.review.findings': 1, 'usage.costUsd': 1 } },
    ).sort({ startedAt: -1 }).limit(2000).toArray()) as RunDoc[];
  }

  async countSince(since: Date): Promise<number> {
    return this.col.countDocuments({ startedAt: { $gte: since } });
  }

  /** Execuções que ficaram "running" após um reinício do servidor viram "failed". */
  async failOrphans(): Promise<void> {
    await this.col.updateMany({ kind: 'task', status: 'running' }, { $set: { 'task.phase': 'failed', 'task.error': 'servidor reiniciado durante a execução' } });
    await this.col.updateMany({ status: 'running' }, { $set: { status: 'failed', endedAt: new Date(), 'result.error': 'servidor reiniciado durante a execução' } });
  }
}
