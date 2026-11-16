import { describe, expect, it } from 'vitest';
import { computeTeamMetrics, prFacts, weekOf, type MetricsPr } from './team-metrics.js';

const H = 3_600_000;
const NOW = Date.parse('2026-11-16T12:00:00Z');
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * H);

const merged = (over: Partial<MetricsPr> = {}): MetricsPr => ({
  url: 'u1', owner: 'ana', status: 'merged', state: 'merged', additions: 100, deletions: 20, mergedAt: at(10),
  statusHistory: [
    { status: 'review_queue', enteredAt: at(50), leftAt: at(40) },   // 10 h esperando o 1º review
    { status: 'rcs', enteredAt: at(40), leftAt: at(30) },            // 10 h com mudanças pedidas
    { status: 're_review', enteredAt: at(30), leftAt: at(20) },
    { status: 'waiting_approves', enteredAt: at(20), leftAt: at(10) },
    { status: 'merged', enteredAt: at(10), leftAt: null },
  ],
  ...over,
});

describe('métricas de entrega do time', () => {
  it('extrai os fatos de um PR mergeado', () => {
    const f = prFacts(merged(), 'squad-a', NOW)!;
    expect(f.cycleMs).toBe(40 * H);
    expect(f.firstReviewWaitMs).toBe(10 * H);
    expect(f.changesRequestedMs).toBe(10 * H);
    expect(f.changesRequestedRounds).toBe(1);
    expect(f.size).toBe(120);
    expect(f.waitingReviewNow).toBe(false);
  });

  it('PR aberto sem review ainda não tem espera fechada, mas conta como esperando', () => {
    const f = prFacts({ url: 'u2', owner: 'bruno', status: 'review_queue', state: 'open', statusHistory: [{ status: 'review_queue', enteredAt: at(30), leftAt: null }] }, undefined, NOW)!;
    expect(f.firstReviewWaitMs).toBeNull();
    expect(f.waitingReviewNow).toBe(true);
  });

  it('resume o período, por semana, pessoa e time', () => {
    const m = computeTeamMetrics([
      { team: 'squad-a', prs: [merged(), merged({ url: 'u3', additions: 500, deletions: 10, statusHistory: [
        { status: 'review_queue', enteredAt: at(20), leftAt: at(18) }, { status: 'waiting_approves', enteredAt: at(18), leftAt: at(12) }, { status: 'merged', enteredAt: at(12), leftAt: null },
      ], mergedAt: at(12) })] },
      { prs: [{ url: 'u2', owner: 'bruno', status: 'review_queue', state: 'open', statusHistory: [{ status: 'review_queue', enteredAt: at(30), leftAt: null }] }] },
      { prs: [merged({ url: 'velho', mergedAt: at(24 * 60) })] }, // fora da janela
    ], 30, NOW);
    expect(m.summary.merged).toBe(2);
    expect(m.summary.open).toBe(1);
    expect(m.summary.medianCycleMs).toBe((40 * H + 8 * H) / 2);
    expect(m.summary.changesRequestedRate).toBe(0.5);
    expect(m.summary.largeRate).toBe(0.5);
    expect(m.waitingOverOneDay).toBe(1);
    expect(m.byOwner.map(o => o.key)).toEqual(['ana', 'bruno']);
    expect(m.byTeam).toHaveLength(1);
    expect(m.weeks.at(-1)).toMatchObject({ week: weekOf(NOW), merged: 2 });
  });

  it('PR repetido em duas issues conta uma vez', () => {
    const m = computeTeamMetrics([{ prs: [merged()] }, { prs: [merged()] }], 30, NOW);
    expect(m.summary.merged).toBe(1);
  });

  it('semana começa na segunda (UTC)', () => {
    expect(weekOf(Date.parse('2026-11-16T12:00:00Z'))).toBe('2026-11-16'); // segunda
    expect(weekOf(Date.parse('2026-11-22T23:00:00Z'))).toBe('2026-11-16'); // domingo
  });
});
