import { describe, expect, it } from 'vitest';
import { computeDora, type DoraIssue } from './dora.js';

const NOW = Date.parse('2026-11-16T15:00:00Z');
const H = 3_600_000;
const issue = (key: string, deployDate: string, extra: Partial<DoraIssue> = {}): DoraIssue => ({
  key, title: `Issue ${key}`, status: 'merged', deployDate, prs: [{ url: `${key}/pr`, title: 'feat', createdAt: new Date(Date.parse(`${deployDate}T15:00:00Z`) - 48 * H) }], ...extra,
});

describe('computeDora', () => {
  it('counts deliveries, deploy days and lead time', () => {
    const d = computeDora([issue('a', '2026-11-10'), issue('b', '2026-11-10'), issue('c', '2026-11-12'), issue('d', '2026-11-20')], [], { days: 14, now: NOW });
    expect(d.deploys.items).toBe(3); // the future date does not count
    expect(d.deploys.days).toBe(2);
    expect(d.deploys.itemsPerWeek).toBeCloseTo(1.5);
    expect(d.leadTime.medianMs).toBe(45 * H); // 48h before 15:00 → noon UTC
  });

  it('ignores open, undated and duplicate ones', () => {
    const d = computeDora([issue('a', '2026-11-10'), issue('a', '2026-11-10'), issue('b', '2026-11-10', { status: 'reviewing' }), { ...issue('c', ''), deployDate: undefined }], [], { days: 14, now: NOW });
    expect(d.deploys.items).toBe(1);
  });

  it('failure = fix by the regex or cause of an incident', () => {
    const fix = issue('fix', '2026-11-11', { title: 'Hotfix: parcela' });
    const bySha = issue('rev', '2026-11-11', { prs: [{ url: 'rev/pr', title: 'Revert "feat x"' }] });
    const byLabel = issue('lbl', '2026-11-11', { prs: [{ url: 'lbl/pr', title: 'x', labels: ['rollback'] }] });
    const caused = issue('https://github.com/o/r/issues/9', '2026-11-12');
    const ok = issue('ok', '2026-11-12');
    const d = computeDora([fix, bySha, byLabel, caused, ok], [
      { severity: 'sev2', startedAt: '2026-11-12T13:00:00Z', detectedAt: '2026-11-12T13:20:00Z', resolvedAt: '2026-11-12T15:00:00Z', causeChanges: ['https://github.com/o/r/issues/9/'] },
      { severity: 'sev3', startedAt: '2026-11-14T10:00:00Z' },
    ], { days: 14, now: NOW });
    expect(d.changeFailure).toMatchObject({ failures: 4, fixes: 3, incidents: 1 });
    expect(d.changeFailure.rate).toBeCloseTo(0.8);
    expect(d.recovery).toMatchObject({ resolved: 1, medianMs: 2 * H, medianDetectMs: 20 * 60_000, open: 1 });
    expect(d.failures.map(f => f.key)).toContain('fix');
  });

  it('a custom regex replaces the default and weeks come from the most recent', () => {
    const d = computeDora([issue('a', '2026-11-03', { title: 'Hotfix' }), issue('b', '2026-11-12', { title: 'URGENTE x' })], [], { days: 30, now: NOW, failureRe: 'urgente' });
    expect(d.changeFailure.failures).toBe(1);
    expect(d.weeks[0]!.week > d.weeks[1]!.week).toBe(true);
  });

  it('real production deploys and recovery by mitigation', () => {
    const d = computeDora([issue('a', '2026-11-10')], [
      { severity: 'sev2', startedAt: '2026-11-12T10:00:00Z', mitigatedAt: '2026-11-12T10:30:00Z', resolvedAt: '2026-11-12T18:00:00Z' },
    ], { days: 14, now: NOW, realDeploys: [{ at: '2026-11-10T15:00:00Z', resource: 'api-prod' }, { at: '2026-11-10T18:00:00Z', resource: 'web-prod' }, { at: '2026-11-13T15:00:00Z', resource: 'api-prod' }, { at: '2026-10-01T00:00:00Z', resource: 'old' }] });
    expect(d.deploys).toMatchObject({ source: 'infra', days: 2, real: { count: 3, days: 2 } });
    expect(d.deploys.items).toBe(1);
    expect(d.recovery.medianMs).toBe(30 * 60_000);
  });
});
