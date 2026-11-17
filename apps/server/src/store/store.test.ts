import { describe, expect, it } from 'vitest';
import { assertOwnCollection, OWN_COLLECTIONS, DeckStore } from './store.js';

describe('collection allowlist', () => {
  it('accepts only the deck_* collections', () => {
    for (const c of OWN_COLLECTIONS) expect(() => assertOwnCollection(c)).not.toThrow();
  });

  it('refuses company collections or anything outside the prefix', () => {
    for (const c of ['legacy_issues', 'messages', 'deck_other', 'PAINEL_PRS']) {
      expect(() => assertOwnCollection(c)).toThrow(/not allowed/);
    }
  });

  it('the store refuses a collection outside the list even with a cast', () => {
    const store = new DeckStore({ uri: undefined, dbName: undefined, legacyPr: undefined });
    expect(() => store.collection('messages' as never)).toThrow(/not allowed/);
  });

  it('without a URI it stays "not configured" and connect() does nothing', async () => {
    const store = new DeckStore({ uri: undefined, dbName: undefined, legacyPr: undefined });
    await store.connect();
    expect(store.status).toEqual({ state: 'not_configured' });
  });
});
