import { describe, expect, it } from 'vitest';
import { deriveStatus, effectiveStatus, enterStatus, groupStatus, prodBranchMatcher, type DeployStatus, type Tracked } from './pr-status.js';

describe('deploy status derived from GitHub', () => {
  it('maps PR states', () => {
    expect(deriveStatus({ state: 'MERGED', reviewDecision: null, reviewCount: 0 })).toBe('merged');
    expect(deriveStatus({ state: 'CLOSED', reviewDecision: null, reviewCount: 0 })).toBeNull();
    expect(deriveStatus({ state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED', reviewCount: 1 })).toBe('rcs');
    expect(deriveStatus({ state: 'OPEN', reviewDecision: 'APPROVED', reviewCount: 2 })).toBe('waiting_approves');
    expect(deriveStatus({ state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED', reviewCount: 1 })).toBe('reviewing');
    expect(deriveStatus({ state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED', reviewCount: 0 })).toBe('review_queue');
  });

  it('re-review: changes requested and then a new commit or a new review request', () => {
    const base = { state: 'OPEN' as const, reviewDecision: 'CHANGES_REQUESTED' as const, reviewCount: 2, lastChangesRequestedAt: '2026-11-16T10:00:00Z' };
    expect(deriveStatus({ ...base, lastCommitAt: '2026-11-16T09:00:00Z' })).toBe('rcs');
    expect(deriveStatus({ ...base, lastCommitAt: '2026-11-16T11:00:00Z' })).toBe('re_review');
    expect(deriveStatus({ ...base, lastCommitAt: '2026-11-16T09:00:00Z', lastReviewRequestedAt: '2026-11-16T12:00:00Z' })).toBe('re_review');
    expect(deriveStatus({ ...base })).toBe('rcs');
  });

  it('the group stays on the least advanced PR; all merged → merged', () => {
    expect(groupStatus(['merged', 'reviewing', 'waiting_approves'])).toBe('reviewing');
    expect(groupStatus(['merged', 'merged'])).toBe('merged');
    expect(groupStatus([])).toBeNull();
  });

  it('merge into a production branch → production; the group is only in production when nothing is open', () => {
    expect(deriveStatus({ state: 'MERGED', reviewDecision: null, reviewCount: 0, intoProduction: true })).toBe('production');
    expect(deriveStatus({ state: 'OPEN', reviewDecision: 'APPROVED', reviewCount: 1, intoProduction: true })).toBe('waiting_approves');
    expect(groupStatus(['merged', 'production'])).toBe('production'); // PR on main + PR on production
    expect(groupStatus(['production', 'waiting_approves'])).toBe('waiting_approves');
  });

  it('production branches with a wildcard', () => {
    const isProd = prodBranchMatcher(['production', 'production-*', 'jobs']);
    expect(['production', 'production-api', 'Production-Hooks', 'jobs'].every(isProd)).toBe(true);
    expect([undefined, 'main', 'develop', 'pre-production', 'jobs-old', 'production.x'].some(isProd)).toBe(false);
    expect(prodBranchMatcher(['release.1'])('releasex1')).toBe(false); // the dot is literal
  });
});

describe('manual status override', () => {
  const ov = { status: 're_review' as DeployStatus, at: '2026-11-16T10:00:00Z', basis: 'rcs' as DeployStatus };
  it('holds while GitHub does not change', () => {
    expect(effectiveStatus('rcs', ov)).toEqual({ status: 're_review', override: ov });
  });
  it('drops by itself when the derived status changes or the PR is merged', () => {
    expect(effectiveStatus('waiting_approves', ov)).toEqual({ status: 'waiting_approves', override: null });
    expect(effectiveStatus('merged', ov)).toEqual({ status: 'merged', override: null });
  });
  it('a manual "in production" on a merged PR holds; production from GitHub drops any override', () => {
    const prod = { status: 'production' as DeployStatus, at: '2026-11-16T10:00:00Z', basis: 'merged' as DeployStatus };
    expect(effectiveStatus('merged', prod)).toEqual({ status: 'production', override: prod });
    expect(effectiveStatus('production', { ...ov, basis: 'production' })).toEqual({ status: 'production', override: null });
  });
  it('without an override it uses the derived status', () => {
    expect(effectiveStatus('reviewing', null)).toEqual({ status: 'reviewing', override: null });
  });
});

describe('status history', () => {
  it('closes the previous status and adds up the time', () => {
    const t0 = new Date('2026-11-16T09:00:00Z');
    const t1 = new Date('2026-11-16T11:00:00Z');
    let doc: { status: DeployStatus } & Parameters<typeof enterStatus>[0] = { status: 'review_queue', statusHistory: [{ status: 'review_queue', enteredAt: t0, leftAt: null }] };
    doc = enterStatus(doc, 'reviewing', t1);
    expect(doc.status).toBe('reviewing');
    expect(doc.statusHistory).toHaveLength(2);
    expect(doc.statusHistory?.[0]?.leftAt).toEqual(t1);
    expect(doc.statusStats?.review_queue).toEqual({ count: 1, totalMs: 2 * 3_600_000 });
  });

  it('is idempotent when the status does not change', () => {
    const doc = { status: 'rcs' as DeployStatus, statusHistory: [{ status: 'rcs' as DeployStatus, enteredAt: new Date(), leftAt: null }] };
    expect(enterStatus(doc, 'rcs')).toBe(doc);
  });

  it('a document without history gets the first entry', () => {
    const doc = enterStatus<Tracked>({ status: 'review_queue' }, 'review_queue', new Date('2026-11-16T00:00:00Z'));
    expect(doc.statusHistory).toHaveLength(1);
  });
});
