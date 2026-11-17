import { k } from './i18n';

// Tech Lead block shapes (mirror apps/server/src/sync/service.ts and domain/*).
export interface SourceState { configured: boolean; lastSync?: string; error?: string; running: boolean }
export type Sources = Record<'github' | 'discord' | 'prs', SourceState>;

export interface QueueItem {
  key: string; source: 'github' | 'discord'; kind: 'issue' | 'pr' | 'message';
  type: string; rank: number; title: string; url: string; repo?: string; number?: number;
  labels: string[]; author?: string; createdAt: string; updatedAt: string; reasons: string[]; answered: boolean;
}

export type PrSize = 'XS' | 'S' | 'M' | 'L' | 'XL';
export interface ReviewItem {
  key: string; title: string; url: string; repo: string; number: number; author?: string;
  isDraft: boolean; additions: number; deletions: number; changedFiles: number; base: string;
  createdAt: string; requestedAt?: string; size: PrSize; lines: number; waitingSince: string; waitingBusinessDays: number;
}

export interface TeamMember { id: string; name: string }
export interface DailyBlocker { text: string; issue?: string; since?: string; dependsOn?: string; inferred: boolean }
export interface PersonDaily {
  member: TeamMember; posted: boolean; postedAt?: string; messageUrl?: string;
  parsed?: { yesterday: string[]; today: string[]; blockers: DailyBlocker[]; confidence?: number };
  lowConfidence: boolean;
  changes: { newBlockers: DailyBlocker[]; resolvedBlockers: DailyBlocker[]; confidenceDelta?: number };
}
export interface DailySummary {
  day: string; people: PersonDaily[]; missing: TeamMember[]; lowConfidence: PersonDaily[];
  blockers: Array<{ member: TeamMember; blocker: DailyBlocker; messageUrl?: string }>; postedCount: number;
}

export interface OpenBlocker {
  key: string; member: TeamMember; text: string; issue?: string; dependsOn?: string;
  since: string; ageMs: number; source: 'daily' | 'channel'; inferred: boolean; messageUrl?: string; channel?: string;
}

export type DeployStatus = 'review_queue' | 'reviewing' | 'rcs' | 're_review' | 'waiting_approves' | 'merged' | 'production';
export const DEPLOY_STATUSES: DeployStatus[] = ['review_queue', 'reviewing', 'rcs', 're_review', 'waiting_approves', 'merged', 'production'];
/** Delivered (merged) or in production: leaves the "open" list. */
export const isDone = (s: DeployStatus) => s === 'merged' || s === 'production';
export interface TrackedPr {
  url: string; title: string; owner: string; author?: string; status: DeployStatus; state: 'open' | 'closed' | 'merged';
  derivedStatus?: DeployStatus; statusOverride?: { status: DeployStatus; at: string; basis: DeployStatus } | null;
  repo?: string; number?: number; base?: string; isDraft?: boolean; additions?: number; deletions?: number;
  source: 'auto' | 'manual' | 'legacy';
}
export interface TrackedIssue {
  _id: string; key: string; title: string; reference?: string; owner: string; team?: string; deployDate?: string;
  deployDateSource?: 'project' | 'manual' | 'legacy'; issueState?: 'OPEN' | 'CLOSED';
  status: DeployStatus; prs: TrackedPr[]; source: 'auto' | 'manual' | 'legacy'; overdue: boolean;
  syncedAt?: string; updatedAt: string; createdAt: string; mergedAt?: string | null;
  statusStats?: Partial<Record<DeployStatus, { count: number; totalMs: number }>>;
  statusHistory?: Array<{ status: DeployStatus; enteredAt: string; leftAt: string | null }>;
}

// label is a translation key: the screen shows t(label).
export const STATUS_META: Record<DeployStatus, { label: string; tone: 'neutral' | 'info' | 'danger' | 'warning' | 'success' }> = {
  review_queue: { label: k('Review queue'), tone: 'neutral' },
  reviewing: { label: k('In review'), tone: 'info' },
  rcs: { label: k('Changes requested|short'), tone: 'danger' },
  re_review: { label: k('Re-review'), tone: 'warning' },
  waiting_approves: { label: k('Waiting for approvals'), tone: 'info' },
  merged: { label: k('Merged'), tone: 'success' },
  production: { label: k('In production'), tone: 'success' },
};
