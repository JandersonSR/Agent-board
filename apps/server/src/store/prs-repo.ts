// painel_prs: acompanhamento de PR/deploy por issue (substitui o cadastro manual do painel anterior).
// O sync automático só atualiza dados vindos do GitHub; campos manuais (deployDate, time, ordem,
// vínculo) nunca são sobrescritos.
import { ObjectId, type Document } from 'mongodb';
import { enterStatus, groupStatus, type DeployStatus, type StatusHistoryEntry, type StatusStats } from '../domain/pr-status.js';
import type { PainelStore } from './mongo.js';

export interface TrackedPr {
  _id?: ObjectId;
  url: string;
  title: string;
  owner: string;
  status: DeployStatus;
  state: 'open' | 'closed' | 'merged';
  repo?: string;
  number?: number;
  base?: string;
  isDraft?: boolean;
  additions?: number;
  deletions?: number;
  mergedAt?: Date | null;
  statusHistory?: StatusHistoryEntry[];
  statusStats?: StatusStats;
  source: 'auto' | 'manual' | 'legacy';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TrackedIssue {
  _id?: ObjectId;
  key: string;            // URL da issue (ou do PR quando não há issue)
  title: string;
  reference?: string;
  owner: string;
  team?: string;
  deployDate?: string;    // YYYY-MM-DD (manual)
  status: DeployStatus;
  mergedAt?: Date | null;
  linkGroup?: string | null;
  deployOrder?: number | null;
  prs: TrackedPr[];
  statusHistory?: StatusHistoryEntry[];
  statusStats?: StatusStats;
  source: 'auto' | 'manual' | 'legacy';
  legacyId?: string;
  syncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncedPr extends Omit<TrackedPr, 'statusHistory' | 'statusStats' | 'source' | 'createdAt' | 'updatedAt' | '_id'> {}
export interface SyncedGroup { key: string; title: string; reference?: string | undefined; owner: string; prs: SyncedPr[] }

/** Junta PRs sincronizados num documento existente (ou novo), preservando o que é manual. */
export function mergeGroup(existing: TrackedIssue | null, group: SyncedGroup, now: Date): TrackedIssue {
  const base: TrackedIssue = existing ?? {
    key: group.key, title: group.title, reference: group.reference, owner: group.owner,
    status: 'review_queue', prs: [], source: 'auto', createdAt: now, updatedAt: now,
  };
  const prs = [...base.prs];
  for (const p of group.prs) {
    const i = prs.findIndex(x => x.url === p.url);
    const prev: TrackedPr = i >= 0 ? prs[i]! : { ...p, source: 'auto', createdAt: now };
    // Mantém o status anterior no objeto para que enterStatus registre a transição.
    const next = enterStatus<TrackedPr>({ ...prev, ...p, status: prev.status, source: prev.source, updatedAt: now }, p.status, now);
    if (i >= 0) prs[i] = next; else prs.push(next);
  }
  const live = prs.filter(p => p.state !== 'closed').map(p => p.status);
  const status = groupStatus(live) ?? base.status;
  let doc: TrackedIssue = {
    ...base,
    title: existing?.title && existing.source !== 'auto' ? existing.title : group.title,
    reference: base.reference ?? group.reference,
    owner: base.owner || group.owner,
    prs,
    syncedAt: now,
    updatedAt: now,
  };
  doc = enterStatus(doc, status, now);
  if (status === 'merged' && !doc.mergedAt) {
    doc.mergedAt = prs.map(p => p.mergedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? now;
  }
  return doc;
}

export class PrsRepo {
  constructor(private readonly store: PainelStore) {}
  private get col() { return this.store.collection<TrackedIssue>('painel_prs'); }

  async list(opts: { includeOldMerged?: boolean; mergedWithinDays?: number } = {}): Promise<TrackedIssue[]> {
    const days = opts.mergedWithinDays ?? 7;
    const filter: Document = opts.includeOldMerged ? {} : {
      $or: [{ status: { $ne: 'merged' } }, { mergedAt: { $gte: new Date(Date.now() - days * 86_400_000) } }, { mergedAt: null }],
    };
    return this.col.find(filter).sort({ updatedAt: -1 }).limit(500).toArray() as Promise<TrackedIssue[]>;
  }

  async upsertGroup(group: SyncedGroup, now = new Date()): Promise<void> {
    const urls = group.prs.map(p => p.url);
    const existing = (await this.col.findOne({ $or: [{ key: group.key }, { reference: group.key }, { 'prs.url': { $in: urls } }] })) as TrackedIssue | null;
    const doc = mergeGroup(existing, group, now);
    const { _id, ...rest } = doc;
    if (_id) await this.col.replaceOne({ _id }, rest);
    else await this.col.insertOne(rest as TrackedIssue);
  }

  async patch(id: string, fields: Partial<Pick<TrackedIssue, 'deployDate' | 'team' | 'owner' | 'title' | 'deployOrder'>>): Promise<TrackedIssue | null> {
    const r = await this.col.findOneAndUpdate({ _id: new ObjectId(id) }, { $set: { ...fields, updatedAt: new Date() } }, { returnDocument: 'after' });
    return r as TrackedIssue | null;
  }

  async count(): Promise<number> { return this.col.countDocuments(); }
  async insertMany(docs: TrackedIssue[]): Promise<number> {
    if (!docs.length) return 0;
    const r = await this.col.insertMany(docs);
    return r.insertedCount;
  }
  async legacyIds(): Promise<Set<string>> {
    const docs = await this.col.find({ legacyId: { $exists: true } }, { projection: { legacyId: 1 } }).toArray();
    return new Set(docs.map(d => String((d as TrackedIssue).legacyId)));
  }
}
