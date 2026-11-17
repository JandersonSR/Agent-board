// deck_runs: agent runs started from the deck (review, task).
// Every text stored here is already masked. The log keeps only the last 400 entries.
import { ObjectId } from 'mongodb';
import type { DeckStore } from '../store/store.js';
import type { RunUsage } from './claude-runner.js';
import type { FindingDecision } from '../domain/review-quality.js';
import type { ReviewResultT } from './review.js';

export type RunKind = 'review' | 'task';
export type RunStatus = 'running' | 'done' | 'failed' | 'timeout' | 'cancelled';

/** Task stages: plan (read-only) → approval → implementation → verification → draft PR. */
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
  worktree: string;      // the task's isolated worktree
  branch: string;
  base: string;          // branch base (ex.: origin/main)
  plan?: TaskPlan;
  notes?: string;        // the Tech Lead's notes when approving
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
  /** Prompt version (template + skill + AI model), to compare quality across versions. */
  promptVersion?: string;
  /** The Tech Lead edited the prompt in the preview before running. */
  promptEdited?: boolean;
  /** The Tech Lead's judgment for each finding (same order as result.review.findings). */
  findingDecisions?: FindingDecision[];
  /** End-to-end task fields (kind = 'task'). */
  task?: TaskState;
  /** Review run against a case of the fixed evaluation set (deck_evals). Never becomes a GitHub review. */
  evalCaseId?: string;
}

export class RunsRepo {
  constructor(private readonly store: DeckStore) {}
  private get col() { return this.store.collection<RunDoc>('deck_runs'); }

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

  /** Reviews finished since a date, with only what the quality measurement needs. */
  async reviewsForQuality(since: Date): Promise<RunDoc[]> {
    return (await this.col.find(
      { kind: 'review', status: 'done', startedAt: { $gte: since }, evalCaseId: { $exists: false } },
      { projection: { startedAt: 1, promptVersion: 1, model: 1, 'target.repo': 1, 'result.review.findings.severity': 1, findingDecisions: 1, usage: 1 } },
    ).toArray()) as RunDoc[];
  }

  /** Runs of the fixed evaluation set, with only what recall uses. */
  async evalRuns(): Promise<RunDoc[]> {
    return (await this.col.find(
      { evalCaseId: { $exists: true } },
      { projection: { evalCaseId: 1, promptVersion: 1, startedAt: 1, status: 1, 'result.review.findings': 1, 'usage.costUsd': 1 } },
    ).sort({ startedAt: -1 }).limit(2000).toArray()) as RunDoc[];
  }

  async countSince(since: Date): Promise<number> {
    return this.col.countDocuments({ startedAt: { $gte: since } });
  }

  /** Runs left "running" after a server restart become "failed". */
  async failOrphans(): Promise<void> {
    await this.col.updateMany({ kind: 'task', status: 'running' }, { $set: { 'task.phase': 'failed', 'task.error': 'server restarted during the run' } });
    await this.col.updateMany({ status: 'running' }, { $set: { status: 'failed', endedAt: new Date(), 'result.error': 'server restarted during the run' } });
  }
}
