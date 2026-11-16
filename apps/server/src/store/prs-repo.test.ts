import { describe, expect, it } from 'vitest';
import { mergeGroup, type SyncedGroup, type TrackedIssue } from './prs-repo.js';

const t0 = new Date('2026-11-16T09:00:00Z');
const t1 = new Date('2026-11-16T12:00:00Z');
const pr = (url: string, status: SyncedGroup['prs'][number]['status'], state: 'open' | 'merged' | 'closed' = 'open') =>
  ({ url, title: `PR ${url}`, owner: 'dev1', status, state, base: 'main' });

describe('mergeGroup (sync de painel_prs)', () => {
  it('cria o grupo com status do PR menos avançado', () => {
    const doc = mergeGroup(null, { key: 'issue/1', title: 'Issue 1', owner: 'dev1', prs: [pr('a', 'reviewing'), pr('b', 'waiting_approves')] }, t0);
    expect(doc.status).toBe('reviewing');
    expect(doc.prs).toHaveLength(2);
    expect(doc.source).toBe('auto');
  });

  it('preserva campos manuais e registra transição com tempo', () => {
    const first = mergeGroup(null, { key: 'k', title: 'T', owner: 'dev1', prs: [pr('a', 'review_queue')] }, t0);
    const manual: TrackedIssue = { ...first, deployDate: '2026-11-20', team: 'alpha', deployOrder: 2 };
    const next = mergeGroup(manual, { key: 'k', title: 'T', owner: 'dev1', prs: [pr('a', 'reviewing')] }, t1);
    expect(next.deployDate).toBe('2026-11-20');
    expect(next.team).toBe('alpha');
    expect(next.status).toBe('reviewing');
    expect(next.prs[0]?.statusStats?.review_queue).toEqual({ count: 1, totalMs: 3 * 3_600_000 });
  });

  it('todos merged → grupo merged; PR fechado sem merge não conta', () => {
    const doc = mergeGroup(null, { key: 'k', title: 'T', owner: 'd', prs: [pr('a', 'merged', 'merged'), pr('b', 'review_queue', 'closed')] }, t0);
    expect(doc.status).toBe('merged');
    expect(doc.mergedAt).toEqual(t0);
  });

  it('não troca título editado à mão (legado/manual)', () => {
    const legacy = { ...mergeGroup(null, { key: 'k', title: 'Auto', owner: 'd', prs: [] }, t0), title: 'Título manual', source: 'legacy' as const };
    expect(mergeGroup(legacy, { key: 'k', title: 'Outro', owner: 'd', prs: [pr('a', 'reviewing')] }, t1).title).toBe('Título manual');
  });
});
