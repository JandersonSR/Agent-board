import { describe, expect, it } from 'vitest';
import { globMatch, mapsForRepo, searchPacks, tokenize } from './search.js';
import type { FeatPack } from './types.js';

// Fictitious packs: only the shape matters.
const pack = (p: Partial<FeatPack> & { id: string; map: string }): FeatPack => ({
  title: '', repos: [], keywords: [], summary: '', tokens: 400, file: `/x/${p.id}.yaml`, ...p,
});

const PACKS: FeatPack[] = [
  pack({ map: 'core', id: 'FEAT-ACCESS-CONTROL', slug: 'access-control', title: 'Access Control / Permissions', domain: 'core', repos: ['REPO-CORE'], summary: 'RBAC com grupos de acesso e permissões' }),
  pack({ map: 'core', id: 'FEAT-POSTBACK', slug: 'postback', title: 'Postback de propostas', domain: 'core', repos: ['REPO-CORE'], summary: 'Envio de eventos de proposta para parceiros', tokens: 900 }),
  pack({ map: 'beta', id: 'EXT-SCORING', title: 'Scoring — motor de decisão externo', domain: 'externo', repos: ['REPO-BETA-WORKER'], keywords: ['politica'], summary: 'Integração com o motor de decisão' }),
];

describe('tokenize', () => {
  it('removes accents, stopwords, numbers and short terms', () => {
    expect(tokenize('Erro no Postback das propostas #7959 (decisão)')).toEqual(['postback', 'propostas', 'decisao']);
  });
});

describe('RAG routing by repo', () => {
  const routes = [{ name: 'beta', patterns: ['beta-*', 'legacy-*'] }];
  it('a repo matching a route only uses the routed RAG', () => {
    expect(mapsForRepo(['core', 'beta'], routes, 'beta-worker')).toEqual(['beta']);
  });
  it('other repos use the RAGs without a route', () => {
    expect(mapsForRepo(['core', 'beta'], routes, 'core')).toEqual(['core']);
  });
  it('no repo uses all of them', () => {
    expect(mapsForRepo(['core', 'beta'], routes)).toEqual(['core', 'beta']);
  });
  it('simple glob', () => {
    expect(globMatch('beta-*', 'BETA-worker')).toBe(true);
    expect(globMatch('beta-*', 'core')).toBe(false);
  });
});

describe('searchPacks', () => {
  it('ranks by field (title and id weigh more than the summary)', () => {
    const hits = searchPacks(PACKS, 'Postback duplicado ao enviar proposta');
    expect(hits[0]?.pack.id).toBe('FEAT-POSTBACK');
    expect(hits[0]?.matched).toContain('title');
  });

  it('bonus for the target repo and filter by RAG', () => {
    const hits = searchPacks(PACKS, 'decisão política', { maps: ['beta'], repo: 'beta-worker' });
    expect(hits.map(h => h.pack.id)).toEqual(['EXT-SCORING']);
    expect(hits[0]?.matched).toContain('repo alvo');
  });

  it('respects the token budget (always returns at least 1)', () => {
    const hits = searchPacks(PACKS, 'permissões postback propostas acesso', { tokenBudget: 500 });
    expect(hits.reduce((n, h) => n + h.pack.tokens, 0)).toBeLessThanOrEqual(900);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('the target repo alone does not bring a pack unrelated to the text', () => {
    const hits = searchPacks(PACKS, 'postback duplicado', { repo: 'core' });
    expect(hits.map(h => h.pack.id)).toEqual(['FEAT-POSTBACK']);
  });

  it('an empty query or one without useful terms returns nothing', () => {
    expect(searchPacks(PACKS, 'de para #123')).toEqual([]);
  });
});
