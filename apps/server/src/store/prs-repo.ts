// deck_prs: PR/deploy tracking per issue (replaces the previous board's manual entry).
// The automatic routine finds each issue's PRs on GitHub; manual fields (edited deploy date,
// team, owner, order, status override) are never overwritten by it.
import { ObjectId, type Document } from 'mongodb';
import {
  DONE_STATUSES, effectiveStatus, enterStatus, groupStatus, isDone,
  type DeployStatus, type StatusHistoryEntry, type StatusOverride, type StatusStats,
} from '../domain/pr-status.js';
import type { DeckStore } from './store.js';

export interface TrackedPr {
  _id?: ObjectId;
  url: string;
  title: string;
  owner: string;
  /** Author's GitHub login (person/team filters). */
  author?: string;
  /** Effective status (derived from GitHub, or the manual override while it holds). */
  status: DeployStatus;
  /** Status derived from GitHub on the last sync. */
  derivedStatus?: DeployStatus;
  statusOverride?: StatusOverride | null;
  state: 'open' | 'closed' | 'merged';
  repo?: string;
  number?: number;
  base?: string;
  isDraft?: boolean;
  additions?: number;
  deletions?: number;
  mergedAt?: Date | null;
  /** Head branch and labels (they identify hotfix/rollback in the DORA metrics). */
  head?: string;
  labels?: string[];
  /** Who reviewed (team member name when known). Only exists on PRs synced from v0.4 on. */
  reviewers?: string[];
  statusHistory?: StatusHistoryEntry[];
  statusStats?: StatusStats;
  source: 'auto' | 'manual' | 'legacy';
  createdAt?: Date;
  updatedAt?: Date;
}

export type DeployDateSource = 'project' | 'manual' | 'legacy';

export interface TrackedIssue {
  _id?: ObjectId;
  key: string;            // Issue URL (or the PR's when there is no issue)
  title: string;
  reference?: string;
  owner: string;
  team?: string;
  deployDate?: string;    // YYYY-MM-DD
  deployDateSource?: DeployDateSource;
  status: DeployStatus;
  issueState?: 'OPEN' | 'CLOSED';
  mergedAt?: Date | null;
  linkGroup?: string | null;
  deployOrder?: number | null;
  prs: TrackedPr[];
  statusHistory?: StatusHistoryEntry[];
  statusStats?: StatusStats;
  source: 'auto' | 'manual' | 'legacy';
  archived?: boolean;
  legacyId?: string;
  syncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncedPr extends Omit<TrackedPr, 'statusHistory' | 'statusStats' | 'source' | 'createdAt' | 'updatedAt' | '_id' | 'derivedStatus' | 'statusOverride'> {}
export interface SyncedGroup {
  key: string;
  title: string;
  reference?: string | undefined;
  owner: string;
  prs: SyncedPr[];
  /** Deploy date from the Project (only applied when there is no manual date). */
  projectDeployDate?: string | undefined;
  issueState?: 'OPEN' | 'CLOSED' | undefined;
  source?: TrackedIssue['source'];
}

function recomputeGroup(doc: TrackedIssue, now: Date): TrackedIssue {
  const live = doc.prs.filter(p => p.state !== 'closed').map(p => p.status);
  const status = groupStatus(live) ?? doc.status;
  let next = enterStatus(doc, status, now);
  if (isDone(status) && !next.mergedAt) {
    next = { ...next, mergedAt: doc.prs.map(p => p.mergedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? now };
  }
  return next;
}

/** Merges synced PRs into an existing (or new) document, keeping what is manual. */
export function mergeGroup(existing: TrackedIssue | null, group: SyncedGroup, now: Date): TrackedIssue {
  const base: TrackedIssue = existing ?? {
    key: group.key, title: group.title, reference: group.reference, owner: group.owner,
    status: 'review_queue', prs: [], source: group.source ?? 'auto', createdAt: now, updatedAt: now,
  };
  const prs = [...base.prs];
  for (const p of group.prs) {
    const i = prs.findIndex(x => x.url === p.url);
    const prev: TrackedPr = i >= 0 ? prs[i]! : { ...p, source: 'auto', createdAt: now };
    const eff = effectiveStatus(p.status, prev.statusOverride);
    // Keeps the previous status on the object so enterStatus records the transition.
    const next = enterStatus<TrackedPr>({
      ...prev, ...p, status: prev.status, derivedStatus: p.status, statusOverride: eff.override, source: prev.source, updatedAt: now,
    }, eff.status, now);
    if (i >= 0) prs[i] = next; else prs.push(next);
  }

  const manualDate = base.deployDateSource === 'manual' || (base.deployDateSource === undefined && base.source === 'legacy' && !!base.deployDate);
  const deploy = !manualDate && group.projectDeployDate
    ? { deployDate: group.projectDeployDate, deployDateSource: 'project' as const }
    : { deployDate: base.deployDate, deployDateSource: base.deployDateSource ?? (base.deployDate ? (base.source === 'legacy' ? 'legacy' as const : 'manual' as const) : undefined) };

  const doc: TrackedIssue = {
    ...base,
    ...deploy,
    title: existing?.title && existing.source !== 'auto' ? existing.title : group.title || base.title,
    reference: base.reference ?? group.reference,
    owner: base.owner || group.owner,
    issueState: group.issueState ?? base.issueState,
    prs,
    syncedAt: now,
    updatedAt: now,
  };
  return recomputeGroup(doc, now);
}

/** Sets (or removes, with null) the manual status override of one of the issue's PRs. */
export function setPrOverride(doc: TrackedIssue, url: string, status: DeployStatus | null, now: Date): TrackedIssue {
  const prs = doc.prs.map(p => {
    if (p.url !== url) return p;
    const derived = p.derivedStatus ?? p.status;
    const override: StatusOverride | null = status && status !== derived ? { status, at: now.toISOString(), basis: derived } : null;
    return enterStatus<TrackedPr>({ ...p, statusOverride: override, updatedAt: now }, override?.status ?? derived, now);
  });
  return recomputeGroup({ ...doc, prs, updatedAt: now }, now);
}

export class PrsRepo {
  constructor(private readonly store: DeckStore) {}
  private get col() { return this.store.collection<TrackedIssue>('deck_prs'); }

  async list(opts: { includeOldMerged?: boolean; mergedWithinDays?: number } = {}): Promise<TrackedIssue[]> {
    const days = opts.mergedWithinDays ?? 7;
    const filter: Document = opts.includeOldMerged ? { archived: { $ne: true } } : {
      archived: { $ne: true },
      $or: [{ status: { $nin: [...DONE_STATUSES] } }, { mergedAt: { $gte: new Date(Date.now() - days * 86_400_000) } }, { mergedAt: null }],
    };
    return this.col.find(filter).sort({ updatedAt: -1 }).limit(500).toArray() as Promise<TrackedIssue[]>;
  }

  /** Issues with a PR open or merged since `since`, with only what the team metrics use. */
  async listForMetrics(since: Date): Promise<TrackedIssue[]> {
    return this.col.find(
      { archived: { $ne: true }, $or: [{ status: { $nin: [...DONE_STATUSES] } }, { mergedAt: { $gte: since } }, { 'prs.mergedAt': { $gte: since } }] },
      { projection: { team: 1, 'prs.url': 1, 'prs.owner': 1, 'prs.status': 1, 'prs.state': 1, 'prs.additions': 1, 'prs.deletions': 1, 'prs.mergedAt': 1, 'prs.statusHistory': 1 } },
    ).limit(2000).toArray() as Promise<TrackedIssue[]>;
  }

  /** Issues with a deploy date since `sinceDay` (YYYY-MM-DD), for the DORA metrics. */
  async listForDora(sinceDay: string): Promise<TrackedIssue[]> {
    return this.col.find(
      { archived: { $ne: true }, deployDate: { $gte: sinceDay } },
      { projection: { key: 1, reference: 1, title: 1, status: 1, deployDate: 1, 'prs.url': 1, 'prs.title': 1, 'prs.labels': 1, 'prs.head': 1, 'prs.createdAt': 1 } },
    ).limit(3000).toArray() as Promise<TrackedIssue[]>;
  }

  /** PRs merged since `since` with author and reviewers, for knowledge concentration. */
  async listForKnowledge(since: Date): Promise<TrackedIssue[]> {
    return this.col.find(
      { 'prs.mergedAt': { $gte: since } },
      { projection: { 'prs.url': 1, 'prs.repo': 1, 'prs.owner': 1, 'prs.state': 1, 'prs.mergedAt': 1, 'prs.reviewers': 1 } },
    ).limit(5000).toArray() as Promise<TrackedIssue[]>;
  }

  /** Light version of every tracked issue, for the product stages' progress. */
  async listLite(): Promise<Array<Pick<TrackedIssue, 'key' | 'reference' | 'title' | 'status' | 'deployDate'>>> {
    return this.col.find({ archived: { $ne: true } }, { projection: { _id: 0, key: 1, reference: 1, title: 1, status: 1, deployDate: 1 } })
      .limit(5000).toArray() as Promise<Array<Pick<TrackedIssue, 'key' | 'reference' | 'title' | 'status' | 'deployDate'>>>;
  }

  async findOne(id: string): Promise<TrackedIssue | null> {
    return (await this.col.findOne({ _id: new ObjectId(id) })) as TrackedIssue | null;
  }

  async upsertGroup(group: SyncedGroup, now = new Date()): Promise<void> {
    const urls = group.prs.map(p => p.url);
    const or: Document[] = [{ key: group.key }, { reference: group.key }];
    if (urls.length) or.push({ 'prs.url': { $in: urls } });
    const existing = (await this.col.findOne({ $or: or })) as TrackedIssue | null;
    if (existing?.archived) return; // stopped tracking: the routine does not bring it back
    if (existing?.status === 'production') return; // in production: delivery closed, the routine no longer touches it
    const doc = mergeGroup(existing, group, now);
    const { _id, ...rest } = doc;
    if (_id) await this.col.replaceOne({ _id }, rest);
    else await this.col.insertOne(rest as TrackedIssue);
  }

  /** Issues the routine should query on GitHub: not archived, not in production and not merged more than `days` ago. */
  async issueRefsToTrack(days = 3): Promise<string[]> {
    const docs = await this.col.find({
      archived: { $ne: true },
      status: { $ne: 'production' },
      reference: { $regex: '/issues/\\d+$' },
      $or: [{ status: { $ne: 'merged' } }, { mergedAt: { $gte: new Date(Date.now() - days * 86_400_000) } }],
    }, { projection: { reference: 1 } }).toArray();
    return [...new Set(docs.map(d => String((d as TrackedIssue).reference)))];
  }

  /** References to Jira/Linear issues still being tracked (same rules as the GitHub ones). */
  async trackerRefsToTrack(days = 3): Promise<string[]> {
    const docs = await this.col.find({
      archived: { $ne: true },
      status: { $ne: 'production' },
      reference: { $regex: '/browse/[A-Z][A-Z0-9_]*-\\d+$|linear\\.app/[^/]+/issue/' },
      $or: [{ status: { $ne: 'merged' } }, { mergedAt: { $gte: new Date(Date.now() - days * 86_400_000) } }],
    }, { projection: { reference: 1 } }).toArray();
    return [...new Set(docs.map(d => String((d as TrackedIssue).reference)))];
  }

  async patch(id: string, fields: Partial<Pick<TrackedIssue, 'deployDate' | 'team' | 'owner' | 'title' | 'deployOrder'>>): Promise<TrackedIssue | null> {
    const set: Document = { ...fields, updatedAt: new Date() };
    if (fields.deployDate !== undefined) set.deployDateSource = 'manual';
    const r = await this.col.findOneAndUpdate({ _id: new ObjectId(id) }, { $set: set }, { returnDocument: 'after' });
    return r as TrackedIssue | null;
  }

  async setOverride(id: string, url: string, status: DeployStatus | null): Promise<TrackedIssue | null> {
    const doc = await this.findOne(id);
    if (!doc?.prs.some(p => p.url === url)) return null;
    const next = setPrOverride(doc, url, status, new Date());
    const { _id, ...rest } = next;
    await this.col.replaceOne({ _id: doc._id! }, rest);
    return next;
  }

  async archive(id: string, archived: boolean): Promise<boolean> {
    const r = await this.col.updateOne({ _id: new ObjectId(id) }, { $set: { archived, updatedAt: new Date() } });
    return r.matchedCount > 0;
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
