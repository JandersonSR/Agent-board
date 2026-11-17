import { describe, expect, it } from 'vitest';
import { reviewersOf } from './service.js';

describe('reviewersOf', () => {
  it('no author, no bots, no repeats, with the team member name', () => {
    const names = new Map([['bruno-dev', 'Bruno']]);
    const pr = {
      author: { login: 'ana' },
      reviews: { totalCount: 4, nodes: [
        { state: 'COMMENTED', submittedAt: null, author: { login: 'bruno-dev' } },
        { state: 'APPROVED', submittedAt: null, author: { login: 'Bruno-Dev' } },
        { state: 'COMMENTED', submittedAt: null, author: { login: 'ana' } },
        { state: 'COMMENTED', submittedAt: null, author: { login: 'coderabbitai[bot]' } },
        { state: 'APPROVED', submittedAt: null, author: { login: 'carla' } },
      ] },
    };
    expect(reviewersOf(pr as never, names)).toEqual(['Bruno', 'carla']);
  });
});
