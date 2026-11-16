import { describe, expect, it } from 'vitest';
import { fetchIssueLinks, parseIssueRef, type GitHubClient } from './github.js';

const issue = (n: number) => ({
  number: n, title: `Issue ${n}`, url: `https://github.com/o/board/issues/${n}`, state: 'OPEN',
  closedByPullRequestsReferences: { nodes: [] }, timelineItems: { nodes: [] },
});

/** GitHub falso: recusa (502) consultas com mais de 2 issues, como acontece com lotes pesados. */
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
  it('divide o lote quando o GitHub recusa e não perde nenhuma issue', async () => {
    const { gh, calls } = fakeGh(2);
    const refs = [1, 2, 3, 4, 5, 6, 7].map(n => `o/board#${n}`);
    const out = await fetchIssueLinks(gh, refs, false);
    expect(out.map(i => i.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(calls[0]).toBe(5); // lote padrão de 5, recusado e dividido
  });

  it('erro persiste com uma issue só: propaga', async () => {
    const { gh } = fakeGh(0);
    await expect(fetchIssueLinks(gh, ['o/board#1'], false)).rejects.toThrow('502');
  });

  it('parseIssueRef aceita link e org/repo#n', () => {
    expect(parseIssueRef('https://github.com/o/board/issues/12')).toEqual({ owner: 'o', repo: 'board', number: 12 });
    expect(parseIssueRef('o/board#12')).toEqual({ owner: 'o', repo: 'board', number: 12 });
    expect(parseIssueRef('board 12')).toBeUndefined();
  });
});
