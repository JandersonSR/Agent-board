import { describe, expect, it } from 'vitest';
import { busFactor, computeKnowledge, type KnowledgePr } from './knowledge.js';

const NOW = Date.parse('2026-11-16T12:00:00Z');
let n = 0;
const pr = (repo: string, owner: string, reviewers?: string[], daysAgo = 3): KnowledgePr =>
  ({ url: `u${n++}`, repo, owner, state: 'merged', mergedAt: new Date(NOW - daysAgo * 86_400_000), ...(reviewers ? { reviewers } : {}) });

describe('busFactor', () => {
  it('uma pessoa em tudo = 1', () => expect(busFactor([new Set(['ana']), new Set(['ana', 'bia']), new Set(['ana'])])).toBe(1));
  it('conhecimento espalhado = maior (precisa de mais da metade sem ninguém)', () => {
    expect(busFactor([new Set(['ana', 'bia']), new Set(['bia', 'caio']), new Set(['caio', 'ana']), new Set(['ana', 'caio'])])).toBe(3);
    expect(busFactor([new Set(['ana']), new Set(['ana']), new Set(['bia']), new Set(['caio'])])).toBe(2);
  });
  it('vazio = 0', () => expect(busFactor([])).toBe(0));
});

describe('computeKnowledge', () => {
  const prs = [
    ...Array.from({ length: 6 }, () => pr('acme/api', 'Ana', ['Bruno'])),
    pr('acme/api', 'Carla', ['Bruno']),
    pr('acme/api', 'Bruno', []),
    pr('acme/web', 'Diego'),
    pr('acme/web', 'Eva', ['Diego']),
    pr('acme/old', 'Ana', ['Bruno'], 60),
    { ...pr('acme/api', 'Ana', ['Bruno']), state: 'open', mergedAt: null },
  ];
  const k = computeKnowledge(prs, 30, NOW);

  it('filtra período e PRs não mergeados', () => {
    expect(k.prs).toBe(10);
    expect(k.repos.map(r => r.repo)).toEqual(['acme/api', 'acme/web']);
  });

  it('risco, revisor dominante e PR sem revisão', () => {
    const api = k.repos[0]!;
    expect(api).toMatchObject({ prs: 8, busFactor: 2, risk: 'medium', lowData: false, unreviewed: 1, unknownReviewers: 0 });
    expect(api.reviewers[0]).toEqual({ name: 'Bruno', prs: 7 });
    expect(api.topReviewerShare).toBe(1);
    expect(k.people.find(p => p.name === 'Bruno')!.soleReviewerOf).toEqual(['acme/api']);
  });

  it('PR sem informação de revisores não conta como sem revisão', () => {
    const web = k.repos[1]!;
    expect(web).toMatchObject({ lowData: true, unreviewed: 0, unknownReviewers: 1 });
    expect(k.withReviewerData).toBe(9);
  });
});
