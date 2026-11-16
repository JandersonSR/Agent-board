// painel_sessoes: execuções de agentes disparadas pelo painel (review, tarefa).
// Todo texto que entra aqui já vem mascarado. O log é limitado às últimas 400 entradas.
import { ObjectId } from 'mongodb';
import type { PainelStore } from '../store/mongo.js';
import type { RunUsage } from './claude-runner.js';
import type { ReviewResultT } from './review.js';

export type RunKind = 'review' | 'task';
export type RunStatus = 'running' | 'done' | 'failed' | 'timeout' | 'cancelled';

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

  async countSince(since: Date): Promise<number> {
    return this.col.countDocuments({ startedAt: { $gte: since } });
  }

  /** Execuções que ficaram "running" após um reinício do servidor viram "failed". */
  async failOrphans(): Promise<void> {
    await this.col.updateMany({ status: 'running' }, { $set: { status: 'failed', endedAt: new Date(), 'result.error': 'servidor reiniciado durante a execução' } });
  }
}
