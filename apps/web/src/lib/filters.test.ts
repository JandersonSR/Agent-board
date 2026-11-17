import { describe, expect, it } from 'vitest';
import { activeCount, applyFilters, EMPTY_FILTERS, facetValues, isBot, matches, nextState, setState, type Filterable, type Filters, type People } from './filters';

// Fictitious logins and teams.
const people: People = {
  me: 'eu-tl',
  teams: [
    { slug: 'team-back', name: 'Back', members: ['ana', 'hugo', 'eu-tl'] },
    { slug: 'team-front', name: 'Front', members: ['bia'] },
  ],
};
const item = (authors: string[], extra: Partial<Filterable> = {}): Filterable => ({ authors, repos: ['org/core'], text: 'Corrige postback', ...extra });
const f = (patch: Partial<Filters>): Filters => ({ ...EMPTY_FILTERS, ...patch });

describe('bots and mine', () => {
  it('recognizes common bots', () => {
    expect(isBot('dependabot[bot]')).toBe(true);
    expect(isBot('dependabot')).toBe(true);
    expect(isBot('renovate-bot')).toBe(true);
    expect(isBot('ana')).toBe(false);
    expect(isBot('robotica')).toBe(false);
  });

  it('hides items only from bots or only mine; keeps mixed items', () => {
    expect(matches(item(['dependabot[bot]']), f({ hideBots: true }), people)).toBe(false);
    expect(matches(item(['eu-tl']), f({ hideMine: true }), people)).toBe(false);
    expect(matches(item(['eu-tl', 'ana']), f({ hideMine: true }), people)).toBe(true);
    expect(matches(item(['dependabot[bot]', 'eu-tl']), f({ hideBots: true, hideMine: true }), people)).toBe(false);
  });
});

describe('person', () => {
  it('show only: one author is enough', () => {
    const only = setState(EMPTY_FILTERS, 'author', 'Hugo', 'include');
    expect(matches(item(['ana', 'hugo']), only, people)).toBe(true);
    expect(matches(item(['ana']), only, people)).toBe(false);
  });

  it('hide: it disappears only when all its authors are hidden', () => {
    const hide = setState(EMPTY_FILTERS, 'author', 'ana', 'exclude');
    expect(matches(item(['ana']), hide, people)).toBe(false);
    expect(matches(item(['ana', 'bia']), hide, people)).toBe(true);
  });

  it('case-insensitive', () => {
    expect(matches(item(['Ana']), setState(EMPTY_FILTERS, 'author', 'ana', 'exclude'), people)).toBe(false);
  });
});

describe('team', () => {
  it('show only one team (from the GitHub members)', () => {
    const back = setState(EMPTY_FILTERS, 'team', 'team-back', 'include');
    expect(matches(item(['hugo']), back, people)).toBe(true);
    expect(matches(item(['bia']), back, people)).toBe(false);
  });

  it('hide a team', () => {
    const noFront = setState(EMPTY_FILTERS, 'team', 'team-front', 'exclude');
    expect(matches(item(['bia']), noFront, people)).toBe(false);
    expect(matches(item(['bia', 'ana']), noFront, people)).toBe(true);
  });

  it('the item\'s explicit team (deploy issue)', () => {
    const only = setState(EMPTY_FILTERS, 'team', 'alfa', 'include');
    expect(matches(item(['bia'], { teams: ['alfa'] }), only, people)).toBe(true);
    expect(matches(item([], { teams: ['alfa'] }), setState(EMPTY_FILTERS, 'team', 'alfa', 'exclude'), people)).toBe(false);
  });
});

describe('repo and text', () => {
  it('filters by repo and by text', () => {
    expect(matches(item(['ana']), setState(EMPTY_FILTERS, 'repo', 'org/core', 'exclude'), people)).toBe(false);
    expect(matches(item(['ana']), f({ text: 'postback' }), people)).toBe(true);
    expect(matches(item(['ana']), f({ text: 'webhook' }), people)).toBe(false);
  });
});

describe('utilities', () => {
  it('click cycle and count', () => {
    expect(nextState('none')).toBe('include');
    expect(nextState('include')).toBe('exclude');
    expect(nextState('exclude')).toBe('none');
    const x = setState(setState(EMPTY_FILTERS, 'author', 'ana', 'include'), 'author', 'ana', 'exclude');
    expect(x.author).toEqual({ include: [], exclude: ['ana'] });
    expect(activeCount({ ...x, hideBots: true })).toBe(2);
  });

  it('values with counts and applyFilters', () => {
    const items = [item(['ana']), item(['ana', 'bia']), item(['dependabot[bot]'])];
    expect(facetValues(items, i => i.authors)[0]).toEqual({ value: 'ana', count: 2 });
    expect(applyFilters(items, i => i, f({ hideBots: true }), people)).toHaveLength(2);
  });
});
