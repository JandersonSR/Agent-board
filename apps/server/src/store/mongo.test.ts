import { describe, expect, it } from 'vitest';
import { assertOwnCollection, OWN_COLLECTIONS, PainelStore } from './mongo.js';

describe('allowlist de coleções', () => {
  it('aceita só as coleções painel_*', () => {
    for (const c of OWN_COLLECTIONS) expect(() => assertOwnCollection(c)).not.toThrow();
  });

  it('recusa coleções da empresa ou fora do prefixo', () => {
    for (const c of ['legacy_issues', 'messages', 'painel_outra', 'PAINEL_PRS']) {
      expect(() => assertOwnCollection(c)).toThrow(/não permitida/);
    }
  });

  it('o store recusa coleção fora da lista mesmo com cast', () => {
    const store = new PainelStore({ uri: undefined, dbName: undefined, legacyPr: undefined });
    expect(() => store.collection('messages' as never)).toThrow(/não permitida/);
  });

  it('sem URI fica "não configurado" e connect() não faz nada', async () => {
    const store = new PainelStore({ uri: undefined, dbName: undefined, legacyPr: undefined });
    await store.connect();
    expect(store.status).toEqual({ state: 'not_configured' });
  });
});
