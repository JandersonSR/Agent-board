import { describe, expect, it } from 'vitest';
import { fetchIssueLinks, parseIssueRef, type GitHubClient } from './github.js';

const issue = (n: number) => ({
  number: n, title: `Issue ${n}`, url: `https://github.com/o/board/issues/${n}`, state: 'OPEN',
  closedByPullRequestsReferences: { nodes: [] }, timelineItems: { nodes: [] },
});

/** Fake GitHub: refuses (502) queries with more than 2 issues, as happens with heavy batches. */
function fakeGh(maxPerQuery: number) {
  const calls: number[] = [];
  const gh = {
    async graphql(query: string) {
      const ids = [...query.matchAll(/(i\d+): repository\(owner: "[^"]+", name: "[^"]+"\) \{ issue\(number: (\d+)\)/g)];
      calls.push(ids.length);
      if (ids.length > maxPerQuery) throw new Error('GitHub HTTP 502');
      return Object.fromEntries(ids.map(m => [m[1], { issue: issue(Number(m[2])) }]));
    },
  };
  return { gh: gh as unknown as GitHubClient, calls };
}

describe('fetchIssueLinks', () => {
  it('splits the batch when GitHub refuses and loses no issue', async () => {
    const { gh, calls } = fakeGh(2);
    const refs = [1, 2, 3, 4, 5, 6, 7].map(n => `o/board#${n}`);
    const out = await fetchIssueLinks(gh, refs, false);
    expect(out.map(i => i.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(calls[0]).toBe(5); // default batch of 5, refused and split
  });

  it('the error persists with a single issue: propagates', async () => {
    const { gh } = fakeGh(0);
    await expect(fetchIssueLinks(gh, ['o/board#1'], false)).rejects.toThrow('502');
  });

  it('parseIssueRef accepts a link and org/repo#n', () => {
    expect(parseIssueRef('https://github.com/o/board/issues/12')).toEqual({ owner: 'o', repo: 'board', number: 12 });
    expect(parseIssueRef('o/board#12')).toEqual({ owner: 'o', repo: 'board', number: 12 });
    expect(parseIssueRef('board 12')).toBeUndefined();
  });
});
