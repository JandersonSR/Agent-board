// Jira and Linear adapters with simulated API answers (no real calls).
import { describe, expect, it } from 'vitest';
import { DEFAULT_JIRA_JQL, findKeys, jiraTracker, keyFromUrl, linearTracker } from './trackers.js';

function fake(answer: (url: string, body: Record<string, unknown>) => unknown) {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url, body, headers: init?.headers as Record<string, string> });
    const r = answer(url, body);
    return new Response(JSON.stringify(r), { status: r === 401 ? 401 : 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetcher, calls };
}

const jiraIssue = (key: string, done = false, deploy?: string) => ({
  key, fields: {
    summary: `Title ${key}`, issuetype: { name: 'Bug' }, status: { name: done ? 'Done' : 'In Progress', statusCategory: { key: done ? 'done' : 'indeterminate' } },
    priority: { name: 'High' }, labels: ['api'], created: '2026-11-10T10:00:00.000-0300', updated: '2026-11-15T10:00:00.000-0300', customfield_10050: deploy ?? null,
  },
});

describe('Jira', () => {
  it('my queue uses the default JQL, pages and maps the fields', async () => {
    const { fetcher, calls } = fake((_u, body) => body.nextPageToken
      ? { issues: [jiraIssue('LOAN-2')], isLast: true }
      : { issues: [jiraIssue('LOAN-1', false, '2026-11-20')], nextPageToken: 'p2', isLast: false });
    const t = jiraTracker({ baseUrl: 'https://acme.atlassian.net/', email: 'a@acme.dev', token: 'secret', projectKeys: ['LOAN'], deployDateField: 'customfield_10050', fetcher });
    const q = await t.myQueue();
    expect(q.map(i => i.key)).toEqual(['LOAN-1', 'LOAN-2']);
    expect(q[0]).toMatchObject({ url: 'https://acme.atlassian.net/browse/LOAN-1', type: 'Bug', status: 'In Progress', done: false, deployDate: '2026-11-20', labels: ['api'] });
    expect(calls[0]!.url).toBe('https://acme.atlassian.net/rest/api/3/search/jql');
    expect(calls[0]!.body).toMatchObject({ jql: DEFAULT_JIRA_JQL, fields: expect.arrayContaining(['summary', 'customfield_10050']) });
    expect(calls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from('a@acme.dev:secret').toString('base64')}`);
    expect(t.owns('https://acme.atlassian.net/browse/LOAN-1')).toBe(true);
  });

  it('issues by key ignore invalid keys (no JQL injection) and read the state', async () => {
    const { fetcher, calls } = fake(() => ({ issues: [jiraIssue('LOAN-9', true)], isLast: true }));
    const t = jiraTracker({ baseUrl: 'https://acme.atlassian.net', email: 'a', token: 't', projectKeys: [], fetcher });
    const [i] = await t.issues(['LOAN-9', 'X) OR project = SECRET', 'loan-1']);
    expect(calls[0]!.body.jql).toBe('key in (LOAN-9)');
    expect(i).toMatchObject({ done: true, deployDate: undefined });
  });

  it('an auth error does not leak the token', async () => {
    const { fetcher } = fake(() => 401);
    await expect(jiraTracker({ baseUrl: 'https://acme.atlassian.net', email: 'a', token: 'ATATTsecret', projectKeys: [], fetcher }).myQueue())
      .rejects.toThrow(/^acme\.atlassian\.net: token without permission or expired$/);
  });
});

const linearIssue = (id: string, type = 'started', due: string | null = null) => ({
  identifier: id, title: `T ${id}`, url: `https://linear.app/acme/issue/${id}/t`, priorityLabel: 'Urgent', createdAt: '2026-11-10T10:00:00Z', updatedAt: '2026-11-15T10:00:00Z',
  dueDate: due, state: { name: type === 'completed' ? 'Done' : 'In Progress', type }, labels: { nodes: [{ name: 'Bug' }] },
});

describe('Linear', () => {
  it('my queue: assigned and not finished, with the API key header', async () => {
    const { fetcher, calls } = fake(() => ({ data: { viewer: { assignedIssues: { nodes: [linearIssue('ENG-1', 'started', '2026-11-21')] } } } }));
    const [i] = await linearTracker({ apiKey: 'lin_api_x', teamKeys: ['ENG'], dueDateIsDeploy: true, fetcher }).myQueue();
    expect(i).toMatchObject({ key: 'ENG-1', type: 'Bug', priority: 'Urgent', done: false, deployDate: '2026-11-21' });
    expect(calls[0]!.headers.Authorization).toBe('lin_api_x');
    expect(String(calls[0]!.body.query)).toContain('nin: ["completed", "canceled"]');
  });

  it('issues by key: unknown ones come back null and the rest is still read', async () => {
    const { fetcher, calls } = fake(() => ({ data: { i0: linearIssue('ENG-2', 'completed'), i1: null }, errors: [{ message: 'Entity not found' }] }));
    const r = await linearTracker({ apiKey: 'k', teamKeys: ['ENG'], fetcher }).issues(['ENG-2', 'ENG-404', 'bad") { x']);
    expect(r.map(i => [i.key, i.done])).toEqual([['ENG-2', true]]);
    expect(String(calls[0]!.body.query)).not.toContain('bad');
  });
});

describe('keys in PRs', () => {
  it('finds keys with the configured prefixes only', () => {
    expect(findKeys('LOAN-12: fix (branch feat/loan-12-x, see CRM-3, UTF-8, FEAT-1)', ['LOAN', 'CRM'])).toEqual(['LOAN-12', 'CRM-3']);
    expect(findKeys('LOAN-12', [])).toEqual([]);
    expect(keyFromUrl('https://acme.atlassian.net/browse/LOAN-12')).toBe('LOAN-12');
    expect(keyFromUrl('https://linear.app/acme/issue/ENG-7/some-title')).toBe('ENG-7');
  });
});
