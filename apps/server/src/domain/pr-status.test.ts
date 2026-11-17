import { describe, expect, it } from 'vitest';
import { deriveStatus, effectiveStatus, enterStatus, groupStatus, prodBranchMatcher, type DeployStatus, type Tracked } from './pr-status.js';

describe('status de deploy derivado do GitHub', () => {
  it('mapeia estados do PR', () => {
    expect(deriveStatus({ state: 'MERGED', reviewDecision: null, reviewCount: 0 })).toBe('merged');
    expect(deriveStatus({ state: 'CLOSED', reviewDecision: null, reviewCount: 0 })).toBeNull();
    expect(deriveStatus({ state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED', reviewCount: 1 })).toBe('rcs');
    expect(deriveStatus({ state: 'OPEN', reviewDecision: 'APPROVED', reviewCount: 2 })).toBe('waiting_approves');
    expect(deriveStatus({ state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED', reviewCount: 1 })).toBe('reviewing');
    expect(deriveStatus({ state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED', reviewCount: 0 })).toBe('review_queue');
  });

  it('re-review: mudanças pedidas e depois commit novo ou novo pedido de review', () => {
    const base = { state: 'OPEN' as const, reviewDecision: 'CHANGES_REQUESTED' as const, reviewCount: 2, lastChangesRequestedAt: '2026-11-16T10:00:00Z' };
    expect(deriveStatus({ ...base, lastCommitAt: '2026-11-16T09:00:00Z' })).toBe('rcs');
    expect(deriveStatus({ ...base, lastCommitAt: '2026-11-16T11:00:00Z' })).toBe('re_review');
    expect(deriveStatus({ ...base, lastCommitAt: '2026-11-16T09:00:00Z', lastReviewRequestedAt: '2026-11-16T12:00:00Z' })).toBe('re_review');
    expect(deriveStatus({ ...base })).toBe('rcs');
  });

  it('o grupo fica no PR menos avançado; todos merged → merged', () => {
    expect(groupStatus(['merged', 'reviewing', 'waiting_approves'])).toBe('reviewing');
    expect(groupStatus(['merged', 'merged'])).toBe('merged');
    expect(groupStatus([])).toBeNull();
  });

  it('merge numa branch de produção → production; o grupo só fica em produção quando nada está aberto', () => {
    expect(deriveStatus({ state: 'MERGED', reviewDecision: null, reviewCount: 0, intoProduction: true })).toBe('production');
    expect(deriveStatus({ state: 'OPEN', reviewDecision: 'APPROVED', reviewCount: 1, intoProduction: true })).toBe('waiting_approves');
    expect(groupStatus(['merged', 'production'])).toBe('production'); // PR na main + PR na production
    expect(groupStatus(['production', 'waiting_approves'])).toBe('waiting_approves');
  });

  it('branches de produção com curinga', () => {
    const isProd = prodBranchMatcher(['production', 'production-*', 'jobs']);
    expect(['production', 'production-api', 'Production-Hooks', 'jobs'].every(isProd)).toBe(true);
    expect([undefined, 'main', 'develop', 'pre-production', 'jobs-old', 'production.x'].some(isProd)).toBe(false);
    expect(prodBranchMatcher(['release.1'])('releasex1')).toBe(false); // ponto é literal
  });
});

describe('ajuste manual de status', () => {
  const ov = { status: 're_review' as DeployStatus, at: '2026-11-16T10:00:00Z', basis: 'rcs' as DeployStatus };
  it('vale enquanto o GitHub não muda', () => {
    expect(effectiveStatus('rcs', ov)).toEqual({ status: 're_review', override: ov });
  });
  it('cai sozinho quando o derivado muda ou o PR é mergeado', () => {
    expect(effectiveStatus('waiting_approves', ov)).toEqual({ status: 'waiting_approves', override: null });
    expect(effectiveStatus('merged', ov)).toEqual({ status: 'merged', override: null });
  });
  it('"em produção" marcado à mão sobre um PR merged vale; production do GitHub derruba qualquer ajuste', () => {
    const prod = { status: 'production' as DeployStatus, at: '2026-11-16T10:00:00Z', basis: 'merged' as DeployStatus };
    expect(effectiveStatus('merged', prod)).toEqual({ status: 'production', override: prod });
    expect(effectiveStatus('production', { ...ov, basis: 'production' })).toEqual({ status: 'production', override: null });
  });
  it('sem ajuste usa o derivado', () => {
    expect(effectiveStatus('reviewing', null)).toEqual({ status: 'reviewing', override: null });
  });
});

describe('histórico de status', () => {
  it('fecha o status anterior e acumula o tempo', () => {
    const t0 = new Date('2026-11-16T09:00:00Z');
    const t1 = new Date('2026-11-16T11:00:00Z');
    let doc: { status: DeployStatus } & Parameters<typeof enterStatus>[0] = { status: 'review_queue', statusHistory: [{ status: 'review_queue', enteredAt: t0, leftAt: null }] };
    doc = enterStatus(doc, 'reviewing', t1);
    expect(doc.status).toBe('reviewing');
    expect(doc.statusHistory).toHaveLength(2);
    expect(doc.statusHistory?.[0]?.leftAt).toEqual(t1);
    expect(doc.statusStats?.review_queue).toEqual({ count: 1, totalMs: 2 * 3_600_000 });
  });

  it('é idempotente quando o status não muda', () => {
    const doc = { status: 'rcs' as DeployStatus, statusHistory: [{ status: 'rcs' as DeployStatus, enteredAt: new Date(), leftAt: null }] };
    expect(enterStatus(doc, 'rcs')).toBe(doc);
  });

  it('documento sem histórico ganha a primeira entrada', () => {
    const doc = enterStatus<Tracked>({ status: 'review_queue' }, 'review_queue', new Date('2026-11-16T00:00:00Z'));
    expect(doc.statusHistory).toHaveLength(1);
  });
});
