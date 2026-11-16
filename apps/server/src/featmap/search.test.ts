import { describe, expect, it } from 'vitest';
import { globMatch, mapsForRepo, searchPacks, tokenize } from './search.js';
import type { FeatPack } from './types.js';

// Packs fictícios: só a forma importa.
const pack = (p: Partial<FeatPack> & { id: string; map: string }): FeatPack => ({
  title: '', repos: [], keywords: [], summary: '', tokens: 400, file: `/x/${p.id}.yaml`, ...p,
});

const PACKS: FeatPack[] = [
  pack({ map: 'core', id: 'FEAT-ACCESS-CONTROL', slug: 'access-control', title: 'Access Control / Permissions', domain: 'core', repos: ['REPO-CORE'], summary: 'RBAC com grupos de acesso e permissões' }),
  pack({ map: 'core', id: 'FEAT-POSTBACK', slug: 'postback', title: 'Postback de propostas', domain: 'core', repos: ['REPO-CORE'], summary: 'Envio de eventos de proposta para parceiros', tokens: 900 }),
  pack({ map: 'beta', id: 'EXT-SCORING', title: 'Scoring — motor de decisão externo', domain: 'externo', repos: ['REPO-BETA-WORKER'], keywords: ['politica'], summary: 'Integração com o motor de decisão' }),
];

describe('tokenize', () => {
  it('remove acentos, stopwords, números e termos curtos', () => {
    expect(tokenize('Erro no Postback das propostas #7959 (decisão)')).toEqual(['postback', 'propostas', 'decisao']);
  });
});

describe('roteamento de RAGs por repo', () => {
  const routes = [{ name: 'beta', patterns: ['beta-*', 'legacy-*'] }];
  it('repo que casa com rota usa só o RAG roteado', () => {
    expect(mapsForRepo(['core', 'beta'], routes, 'beta-worker')).toEqual(['beta']);
  });
  it('outros repos usam os RAGs sem rota', () => {
    expect(mapsForRepo(['core', 'beta'], routes, 'core')).toEqual(['core']);
  });
  it('sem repo usa todos', () => {
    expect(mapsForRepo(['core', 'beta'], routes)).toEqual(['core', 'beta']);
  });
  it('glob simples', () => {
    expect(globMatch('beta-*', 'BETA-worker')).toBe(true);
    expect(globMatch('beta-*', 'core')).toBe(false);
  });
});

describe('searchPacks', () => {
  it('ranqueia por campo (título e id pesam mais que o resumo)', () => {
    const hits = searchPacks(PACKS, 'Postback duplicado ao enviar proposta');
    expect(hits[0]?.pack.id).toBe('FEAT-POSTBACK');
    expect(hits[0]?.matched).toContain('title');
  });

  it('bônus para o repo alvo e filtro por RAG', () => {
    const hits = searchPacks(PACKS, 'decisão política', { maps: ['beta'], repo: 'beta-worker' });
    expect(hits.map(h => h.pack.id)).toEqual(['EXT-SCORING']);
    expect(hits[0]?.matched).toContain('repo alvo');
  });

  it('respeita o orçamento de tokens (sempre devolve ao menos 1)', () => {
    const hits = searchPacks(PACKS, 'permissões postback propostas acesso', { tokenBudget: 500 });
    expect(hits.reduce((n, h) => n + h.pack.tokens, 0)).toBeLessThanOrEqual(900);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('repo alvo sozinho não traz pack sem relação com o texto', () => {
    const hits = searchPacks(PACKS, 'postback duplicado', { repo: 'core' });
    expect(hits.map(h => h.pack.id)).toEqual(['FEAT-POSTBACK']);
  });

  it('consulta vazia ou sem termos úteis não devolve nada', () => {
    expect(searchPacks(PACKS, 'de para #123')).toEqual([]);
  });
});
