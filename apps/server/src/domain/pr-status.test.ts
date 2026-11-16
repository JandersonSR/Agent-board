import { describe, expect, it } from 'vitest';
import { deriveStatus, enterStatus, groupStatus, type DeployStatus } from './pr-status.js';

describe('status de deploy derivado do GitHub', () => {
  it('mapeia estados do PR', () => {
    expect(deriveStatus({ state: 'MERGED', reviewDecision: null, reviewCount: 0 })).toBe('merged');
    expect(deriveStatus({ state: 'CLOSED', reviewDecision: null, reviewCount: 0 })).toBeNull();
    expect(deriveStatus({ state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED', reviewCount: 1 })).toBe('rcs');
    expect(deriveStatus({ state: 'OPEN', reviewDecision: 'APPROVED', reviewCount: 2 })).toBe('waiting_approves');
    expect(deriveStatus({ state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED', reviewCount: 1 })).toBe('reviewing');
    expect(deriveStatus({ state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED', reviewCount: 0 })).toBe('review_queue');
  });

  it('o grupo fica no PR menos avançado; todos merged → merged', () => {
    expect(groupStatus(['merged', 'reviewing', 'waiting_approves'])).toBe('reviewing');
    expect(groupStatus(['merged', 'merged'])).toBe('merged');
    expect(groupStatus([])).toBeNull();
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
    const doc = enterStatus({ status: 'review_queue' as DeployStatus }, 'review_queue', new Date('2026-11-16T00:00:00Z'));
    expect(doc.statusHistory).toHaveLength(1);
  });
});
