// PR deploy status (same flow as the previous PR board), derived from GitHub,
// and the history/time in each status.

export const STATUSES = ['review_queue', 'reviewing', 'rcs', 're_review', 'waiting_approves', 'merged', 'production'] as const;
export type DeployStatus = (typeof STATUSES)[number];

/** Final statuses: already delivered (merged) or already in production. They do not count time and leave the "open" list. */
export const DONE_STATUSES: readonly DeployStatus[] = ['merged', 'production'];
export const isDone = (s: DeployStatus | undefined | null): boolean => !!s && DONE_STATUSES.includes(s);

/**
 * Production branch? Comma-separated patterns, with a trailing * as a wildcard ("production*", "jobs").
 * A merge into one of them = already in production.
 */
export function prodBranchMatcher(patterns: string[]): (base: string | undefined) => boolean {
  const res = patterns.map(p => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i'));
  return base => !!base && res.some(r => r.test(base));
}

export const STATUS_LABEL: Record<DeployStatus, string> = {
  review_queue: 'Review queue',
  reviewing: 'In review',
  rcs: 'RCs (changes requested)',
  re_review: 'Re-review',
  waiting_approves: 'Waiting for approvals',
  merged: 'Merged',
  production: 'In production',
};

export interface GhPrState {
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  /** Total reviews/review comments already made (any state). */
  reviewCount: number;
  /** Last review requesting changes (ISO). */
  lastChangesRequestedAt?: string | null | undefined;
  /** Last commit on the PR (ISO). */
  lastCommitAt?: string | null | undefined;
  /** Last review request (ISO). */
  lastReviewRequestedAt?: string | null | undefined;
  /** Merged into a production branch (see prodBranchMatcher). */
  intoProduction?: boolean | undefined;
}

const after = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && Date.parse(a) > Date.parse(b);

/**
 * - merged into a production branch → production
 * - merged → merged
 * - changes requested and, after that, a new commit or a new review request → re_review
 * - changes requested → rcs
 * - approved (still open: missing an extra approval, checks or the merge) → waiting_approves
 * - already reviewed but no decision → reviewing
 * - nenhum review → review_queue
 * A PR closed without merge returns null (leaves tracking).
 */
export function deriveStatus(pr: GhPrState): DeployStatus | null {
  if (pr.state === 'MERGED') return pr.intoProduction ? 'production' : 'merged';
  if (pr.state === 'CLOSED') return null;
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    const rc = pr.lastChangesRequestedAt;
    return after(pr.lastCommitAt, rc) || after(pr.lastReviewRequestedAt, rc) ? 're_review' : 'rcs';
  }
  if (pr.reviewDecision === 'APPROVED') return 'waiting_approves';
  if (pr.reviewCount > 0) return 'reviewing';
  return 'review_queue';
}

/**
 * Group (issue) status = the least advanced PR still open. All delivered: production if any is
 * already in production (e.g. a PR on main + a PR on production), otherwise merged.
 */
export function groupStatus(statuses: DeployStatus[]): DeployStatus | null {
  if (!statuses.length) return null;
  const open = statuses.filter(s => !isDone(s));
  if (!open.length) return statuses.includes('production') ? 'production' : 'merged';
  return open.reduce((min, s) => (STATUSES.indexOf(s) < STATUSES.indexOf(min) ? s : min));
}

export interface StatusHistoryEntry { status: DeployStatus; enteredAt: Date; leftAt: Date | null }
export type StatusStats = Partial<Record<Exclude<DeployStatus, 'merged' | 'production'>, { count: number; totalMs: number }>>;

export interface Tracked { status: DeployStatus; statusHistory?: StatusHistoryEntry[]; statusStats?: StatusStats }

/** Applies a transition (idempotent if the status did not change) and updates the time per status. */
export function enterStatus<T extends Tracked>(doc: T, next: DeployStatus, at: Date = new Date()): T {
  if (doc.status === next && doc.statusHistory?.length) return doc;
  const history = [...(doc.statusHistory ?? [])];
  const stats: StatusStats = { ...(doc.statusStats ?? {}) };
  const last = history[history.length - 1];
  if (last && !last.leftAt) {
    history[history.length - 1] = { ...last, leftAt: at };
    if (last.status !== 'merged' && last.status !== 'production') {
      const prev = stats[last.status] ?? { count: 0, totalMs: 0 };
      stats[last.status] = { count: prev.count + 1, totalMs: prev.totalMs + Math.max(0, at.getTime() - new Date(last.enteredAt).getTime()) };
    }
  }
  history.push({ status: next, enteredAt: at, leftAt: null });
  return { ...doc, status: next, statusHistory: history, statusStats: stats };
}

// ---------- Ajuste manual ----------
/**
 * A manually chosen status holds while GitHub stays in the state it was in when it
 * was set ("basis"). If the derived status changes (new review, approval, merge), the override drops by itself.
 * A manual "production" on a merged PR holds until the end (GitHub does not know when it went to
 * production); a "production" from GitHub is final and drops any override.
 */
export interface StatusOverride { status: DeployStatus; at: string; basis: DeployStatus }

export function effectiveStatus(derived: DeployStatus, override: StatusOverride | null | undefined): { status: DeployStatus; override: StatusOverride | null } {
  if (!override) return { status: derived, override: null };
  if (derived === 'production' || override.basis !== derived) return { status: derived, override: null };
  return { status: override.status, override };
}
