import { describe, expect, it } from 'vitest';
import { mergeGroup, setPrOverride, type SyncedGroup, type TrackedIssue } from './prs-repo.js';

const t0 = new Date('2026-11-16T09:00:00Z');
const t1 = new Date('2026-11-16T12:00:00Z');
const pr = (url: string, status: SyncedGroup['prs'][number]['status'], state: 'open' | 'merged' | 'closed' = 'open') =>
  ({ url, title: `PR ${url}`, owner: 'dev1', status, state, base: 'main' });

describe('mergeGroup (deck_prs sync)', () => {
  it('creates the group with the status of the least advanced PR', () => {
    const doc = mergeGroup(null, { key: 'issue/1', title: 'Issue 1', owner: 'dev1', prs: [pr('a', 'reviewing'), pr('b', 'waiting_approves')] }, t0);
    expect(doc.status).toBe('reviewing');
    expect(doc.prs).toHaveLength(2);
    expect(doc.source).toBe('auto');
  });

  it('keeps manual fields and records the transition with time', () => {
    const first = mergeGroup(null, { key: 'k', title: 'T', owner: 'dev1', prs: [pr('a', 'review_queue')] }, t0);
    const manual: TrackedIssue = { ...first, deployDate: '2026-11-20', team: 'alpha', deployOrder: 2 };
    const next = mergeGroup(manual, { key: 'k', title: 'T', owner: 'dev1', prs: [pr('a', 'reviewing')] }, t1);
    expect(next.deployDate).toBe('2026-11-20');
    expect(next.team).toBe('alpha');
    expect(next.status).toBe('reviewing');
    expect(next.prs[0]?.statusStats?.review_queue).toEqual({ count: 1, totalMs: 3 * 3_600_000 });
  });

  it('all merged → group merged; a PR closed without merge does not count', () => {
    const doc = mergeGroup(null, { key: 'k', title: 'T', owner: 'd', prs: [pr('a', 'merged', 'merged'), pr('b', 'review_queue', 'closed')] }, t0);
    expect(doc.status).toBe('merged');
    expect(doc.mergedAt).toEqual(t0);
  });

  it('in production: the group closes with mergedAt and the time does not count for merged/production', () => {
    const first = mergeGroup(null, { key: 'k', title: 'T', owner: 'd', prs: [pr('a', 'merged', 'merged')] }, t0);
    const doc = setPrOverride(first, 'a', 'production', t1);
    expect(doc.status).toBe('production');
    expect(doc.prs[0]).toMatchObject({ status: 'production', statusOverride: { status: 'production', basis: 'merged' } });
    expect(doc.mergedAt).toEqual(t0);
    expect(Object.keys(doc.prs[0]!.statusStats ?? {})).toEqual([]); // merged → production does not add time
    // Sync seguinte (GitHub continua "merged"): o ajuste vale.
    expect(mergeGroup(doc, { key: 'k', title: 'T', owner: 'd', prs: [pr('a', 'merged', 'merged')] }, t1).status).toBe('production');
    // Back to automatic unlocks it.
    expect(setPrOverride(doc, 'a', null, t1).status).toBe('merged');
  });

  it('does not replace a title edited by hand (legacy/manual)', () => {
    const legacy = { ...mergeGroup(null, { key: 'k', title: 'Auto', owner: 'd', prs: [] }, t0), title: 'Título manual', source: 'legacy' as const };
    expect(mergeGroup(legacy, { key: 'k', title: 'Outro', owner: 'd', prs: [pr('a', 'reviewing')] }, t1).title).toBe('Título manual');
  });
});

describe('deploy date and manual override', () => {
  it('the Project date comes in; a date edited by hand is not overwritten', () => {
    const g = { key: 'k', title: 'T', owner: 'd', prs: [pr('a', 'reviewing')], projectDeployDate: '2026-11-20' };
    const first = mergeGroup(null, g, t0);
    expect(first).toMatchObject({ deployDate: '2026-11-20', deployDateSource: 'project' });
    const edited: TrackedIssue = { ...first, deployDate: '2026-11-25', deployDateSource: 'manual' };
    expect(mergeGroup(edited, { ...g, projectDeployDate: '2026-11-30' }, t1)).toMatchObject({ deployDate: '2026-11-25', deployDateSource: 'manual' });
  });

  it('a date migrated from the old board counts as manual', () => {
    const legacy: TrackedIssue = { ...mergeGroup(null, { key: 'k', title: 'T', owner: 'd', prs: [] }, t0), source: 'legacy', deployDate: '2026-11-21', deployDateSource: undefined };
    expect(mergeGroup(legacy, { key: 'k', title: 'T', owner: 'd', prs: [], projectDeployDate: '2026-12-01' }, t1).deployDate).toBe('2026-11-21');
  });

  it('a manual re-review holds until GitHub changes', () => {
    let doc = mergeGroup(null, { key: 'k', title: 'T', owner: 'd', prs: [pr('a', 'rcs')] }, t0);
    doc = setPrOverride(doc, 'a', 're_review', t1);
    expect(doc.prs[0]).toMatchObject({ status: 're_review', derivedStatus: 'rcs' });
    expect(doc.status).toBe('re_review');
    // next sync, GitHub still in rcs: the override stays
    doc = mergeGroup(doc, { key: 'k', title: 'T', owner: 'd', prs: [pr('a', 'rcs')] }, t1);
    expect(doc.prs[0]?.status).toBe('re_review');
    // GitHub aprovou: ajuste cai sozinho
    doc = mergeGroup(doc, { key: 'k', title: 'T', owner: 'd', prs: [pr('a', 'waiting_approves')] }, t1);
    expect(doc.prs[0]).toMatchObject({ status: 'waiting_approves', statusOverride: null });
  });

  it('removing the override goes back to the derived status', () => {
    let doc = mergeGroup(null, { key: 'k', title: 'T', owner: 'd', prs: [pr('a', 'rcs')] }, t0);
    doc = setPrOverride(doc, 'a', 're_review', t1);
    doc = setPrOverride(doc, 'a', null, t1);
    expect(doc.prs[0]).toMatchObject({ status: 'rcs', statusOverride: null });
  });
});

describe('PrsRepo: a card in production leaves tracking', () => {
  it('the routine does not update or query a card in production; back to automatic unlocks it', async () => {
    const { DeckStore } = await import('./store.js');
    const { PrsRepo } = await import('./prs-repo.js');
    const store = new DeckStore({ uri: undefined, dbName: undefined, legacyPr: undefined, storage: 'sqlite', sqliteFile: ':memory:' });
    await store.connect();
    const repo = new PrsRepo(store);
    const key = 'https://github.com/o/board/issues/7';
    const group = (title: string, prs: SyncedGroup['prs']): SyncedGroup => ({ key, reference: key, title, owner: 'd', prs });

    await repo.upsertGroup(group('T', [pr('https://github.com/o/r/pull/1', 'merged', 'merged')]));
    expect(await repo.issueRefsToTrack()).toEqual([key]);
    const doc = (await repo.list({ includeOldMerged: true }))[0]!;
    await repo.setOverride(String(doc._id), 'https://github.com/o/r/pull/1', 'production');

    expect(await repo.issueRefsToTrack()).toEqual([]);
    await repo.upsertGroup(group('Título novo', [pr('https://github.com/o/r/pull/1', 'merged', 'merged'), pr('https://github.com/o/r/pull/2', 'reviewing')]));
    const frozen = (await repo.list({ includeOldMerged: true }))[0]!;
    expect(frozen).toMatchObject({ status: 'production', title: 'T' });
    expect(frozen.prs).toHaveLength(1);

    await repo.setOverride(String(doc._id), 'https://github.com/o/r/pull/1', null);
    expect(await repo.issueRefsToTrack()).toEqual([key]);
    await store.close();
  });

  it('a merge into a production branch from the sync freezes the card', async () => {
    const { DeckStore } = await import('./store.js');
    const { PrsRepo } = await import('./prs-repo.js');
    const store = new DeckStore({ uri: undefined, dbName: undefined, legacyPr: undefined, storage: 'sqlite', sqliteFile: ':memory:' });
    await store.connect();
    const repo = new PrsRepo(store);
    await repo.upsertGroup({ key: 'k', title: 'T', owner: 'd', prs: [{ ...pr('u1', 'production', 'merged'), base: 'production' }] });
    await repo.upsertGroup({ key: 'k', title: 'T', owner: 'd', prs: [{ ...pr('u1', 'production', 'merged'), base: 'production' }, pr('u2', 'review_queue')] });
    const [doc] = await repo.list({ includeOldMerged: true });
    expect(doc).toMatchObject({ status: 'production' });
    expect(doc!.prs.map(p => p.url)).toEqual(['u1']);
    await store.close();
  });
});
