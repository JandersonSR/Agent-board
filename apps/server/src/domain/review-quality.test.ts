import { describe, expect, it } from 'vitest';
import { computeReviewQuality, keptFindingIndexes, type QualityRun } from './review-quality.js';

const run = (over: Partial<QualityRun>): QualityRun => ({
  startedAt: '2026-11-10T12:00:00Z', promptVersion: 'v1', repo: 'acme/api', findings: [], costUsd: 0.1, durationMs: 30_000, ...over,
});

describe('qualidade da review por IA', () => {
  it('precisão = aceitos ÷ julgados, cobertura = julgados ÷ achados', () => {
    const q = computeReviewQuality([
      run({ findings: [{ severity: 'high' }, { severity: 'low' }, { severity: 'note' }], decisions: ['accepted', 'rejected', null] }),
      run({ findings: [{ severity: 'high' }], decisions: ['accepted'] }),
    ], 30);
    expect(q.overall).toMatchObject({ runs: 2, findings: 4, judged: 3, accepted: 2, rejected: 1 });
    expect(q.overall.precision).toBeCloseTo(2 / 3);
    expect(q.overall.coverage).toBeCloseTo(3 / 4);
    expect(q.overall.costPerAccepted).toBeCloseTo(0.1);
  });

  it('separa por versão do prompt, severidade e repositório', () => {
    const q = computeReviewQuality([
      run({ promptVersion: 'a', findings: [{ severity: 'high' }], decisions: ['rejected'] }),
      run({ promptVersion: 'b', repo: 'acme/web', findings: [{ severity: 'high' }, { severity: 'medium' }], decisions: ['accepted', 'accepted'] }),
    ], 30);
    expect(q.byVersion.find(b => b.key === 'a')?.precision).toBe(0);
    expect(q.byVersion.find(b => b.key === 'b')?.precision).toBe(1);
    expect(q.bySeverity.map(b => b.key)).toEqual(['high', 'medium']);
    expect(q.bySeverity[0]).toMatchObject({ findings: 2, accepted: 1, rejected: 1, runs: 2 });
    expect(q.byRepo.find(b => b.key === 'acme/web')?.accepted).toBe(2);
  });

  it('sem julgamento não inventa precisão', () => {
    const q = computeReviewQuality([run({ findings: [{ severity: 'low' }] })], 7);
    expect(q.overall.precision).toBeNull();
    expect(q.overall.costPerAccepted).toBeNull();
    expect(computeReviewQuality([], 7).overall.coverage).toBeNull();
  });

  it('review PENDING leva os aceitos e os não julgados, nunca os rejeitados', () => {
    expect(keptFindingIndexes(4, ['accepted', 'rejected', null])).toEqual([0, 2, 3]);
    expect(keptFindingIndexes(2, undefined)).toEqual([0, 1]);
  });
});
