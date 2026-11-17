import { describe, expect, it } from 'vitest';
import { DeckStore } from '../store/store.js';
import { computeDora } from '../domain/dora.js';
import { computeKnowledge } from '../domain/knowledge.js';
import { computeTeamMetrics } from '../domain/team-metrics.js';
import { PrsRepo } from '../store/prs-repo.js';
import { demoData, seedDemo } from './seed.js';

describe('demo mode', () => {
  it('seeds once and the data feeds every metric', async () => {
    const store = new DeckStore({ uri: undefined, dbName: undefined, legacyPr: undefined, storage: 'sqlite', sqliteFile: ':memory:' });
    expect(await seedDemo(store, 'en')).toBe(true);
    expect(await seedDemo(store, 'en')).toBe(false);
    const repo = new PrsRepo(store);
    const since = new Date(Date.now() - 90 * 86_400_000);
    const dora = computeDora(await repo.listForDora(since.toISOString().slice(0, 10)), await store.collection('deck_incidents').find({}).toArray() as never, { days: 90 });
    expect(dora.deploys.items).toBeGreaterThan(10);
    expect(dora.changeFailure.failures).toBeGreaterThan(0);
    expect(dora.recovery.resolved).toBe(1);
    const team = computeTeamMetrics(await repo.listForMetrics(since), 90);
    expect(team.summary.merged).toBeGreaterThan(10);
    const k = computeKnowledge((await repo.listForKnowledge(since)).flatMap(d => d.prs.map(p => ({ ...p }))), 90);
    expect(k.repos.find(r => r.repo === 'acme/loans-api')!.reviewers[0]!.name).toBe('Janderson');
    await store.close();
  });

  it('fictitious sources in both languages', () => {
    expect(demoData('en').queue[0]!.title).toMatch(/off by one cent/);
    expect(demoData('pt-BR').daily.missing[0]!.name).toBe('Felipe');
  });
});
