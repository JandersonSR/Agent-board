// The sync with fake chat and tracker sources: daily, mentions and the tracker queue, and PRs grouped
// under Jira issues by the key in the title or branch.
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../config.js';
import type { ChatMessage, ChatSource } from '../sources/chat.js';
import type { DeployPrNodeT } from '../sources/github.js';
import type { TrackerIssue, TrackerSource } from '../sources/trackers.js';
import { DeckStore } from '../store/store.js';
import { SyncService } from './service.js';

const quiet = { warn: () => undefined, error: () => undefined };
const noMask = (s: string) => ({ text: s, counts: {} }) as never;
const now = Date.now();
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

const msg = (id: string, channelId: string, authorId: string, text: string, min: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, channelId, authorId, authorName: authorId.toUpperCase(), isBot: false, text, at: ago(min), url: `https://chat/${id}`, mentions: [], groupMentions: [], ...extra,
});

function fakeChat(byChannel: Record<string, ChatMessage[]>): ChatSource {
  return { provider: 'slack', label: 'Slack', messagesSince: async ch => byChannel[ch] ?? [] };
}

const issue = (key: string, extra: Partial<TrackerIssue> = {}): TrackerIssue => ({
  provider: 'jira', key, url: `https://acme.atlassian.net/browse/${key}`, title: `Title ${key}`, type: 'Story', status: 'In Progress', done: false,
  labels: [], createdAt: ago(600), updatedAt: ago(60), ...extra,
});

function fakeJira(issues: TrackerIssue[]): TrackerSource & { asked: string[][] } {
  const asked: string[][] = [];
  return {
    provider: 'jira', label: 'Jira', prefixes: ['LOAN'], asked,
    myQueue: async () => issues.filter(i => !i.done),
    issues: async keys => { asked.push(keys); return issues.filter(i => keys.includes(i.key)); },
    owns: url => url.includes('atlassian.net/browse/'),
  };
}

const pr = (n: number, title: string, head: string, extra: Partial<DeployPrNodeT> = {}): DeployPrNodeT => ({
  id: `p${n}`, number: n, title, url: `https://github.com/acme/api/pull/${n}`, body: '', state: 'OPEN', isDraft: false,
  createdAt: ago(300), updatedAt: ago(30), mergedAt: null, baseRefName: 'develop', headRefName: head, reviewDecision: null,
  additions: 10, deletions: 2, author: { login: 'ana' }, repository: { nameWithOwner: 'acme/api' },
  reviews: { totalCount: 0, nodes: [] }, labels: { nodes: [] }, commits: { nodes: [] }, timelineItems: { nodes: [] },
  closingIssuesReferences: { nodes: [] }, ...extra,
});

describe('sync with chat and tracker adapters', () => {
  it('daily and mentions from Slack, my Jira queue next to them', async () => {
    const store = new DeckStore({ uri: undefined, dbName: undefined, legacyPr: undefined, storage: 'none' });
    const cfg = parseConfig({ STORAGE: 'none' });
    const chat = fakeChat({
      D: [msg('d1', 'D', 'U2', '## Hoje\n- api\n## Bloqueios\n- nenhum\nConfiança: 4/5', 30)],
      S: [
        msg('s1', 'S', 'U3', '<@ME> pode olhar o erro do contrato?', 90, { mentions: ['ME'] }),
        msg('s2', 'S', 'U3', 'time <!subteam^LEADS>: deploy hoje?', 60, { groupMentions: ['LEADS'], replyUsers: ['ME'] }),
        msg('s3', 'S', 'U3', 'sem menção', 50),
      ],
    });
    const sync = new SyncService(cfg, store, noMask, quiet, {
      chat: { source: chat, settings: { dailyChannelId: 'D', watchChannels: [{ label: 'support', id: 'S' }], myUserId: 'ME', myGroupIds: ['LEADS'], team: [{ id: 'U2', name: 'Ana' }] } },
      trackers: [fakeJira([issue('LOAN-7', { type: 'Bug' }), issue('LOAN-8', { done: true })])],
    });
    expect(sync.state.chat).toMatchObject({ configured: true, provider: 'Slack' });
    expect(sync.state.tracker).toMatchObject({ configured: true, provider: 'Jira' });
    await sync.run();
    expect(sync.daily).toMatchObject({ postedCount: 1, missing: [] });
    const q = sync.queue.map(i => ({ source: i.source, origin: i.origin, title: i.title, answered: i.answered }));
    expect(q).toEqual(expect.arrayContaining([
      { source: 'chat', origin: 'Slack · support', title: 'pode olhar o erro do contrato?', answered: false },
      { source: 'chat', origin: 'Slack · support', title: 'time : deploy hoje?', answered: true },
      { source: 'jira', origin: 'Jira · LOAN-7', title: 'Title LOAN-7', answered: false },
    ]));
    expect(q).toHaveLength(3);
  });

  it('PRs that mention a Jira key are grouped under the Jira issue, with its deploy date and state', async () => {
    const store = new DeckStore({ uri: undefined, dbName: undefined, legacyPr: undefined, storage: 'sqlite', sqliteFile: ':memory:' });
    await store.connect();
    const jira = fakeJira([issue('LOAN-12', { deployDate: '2026-11-20' })]);
    const sync = new SyncService(parseConfig({ STORAGE: 'sqlite', GITHUB_ORG: 'acme' }), store, noMask, quiet, { trackers: [jira] });
    const group = (sync as unknown as { groupAndSave(prs: DeployPrNodeT[], names: Map<string, string>): Promise<void> }).groupAndSave.bind(sync);
    await group([
      pr(1, 'LOAN-12: rounding per installment', 'feat/rounding'),
      pr(2, 'tests for the rounding', 'feat/loan-12-tests'),
      pr(3, 'LOAN-999 unknown to Jira', 'fix/x'),
      pr(4, 'chore: deps', 'chore/deps'),
    ], new Map([['ana', 'Ana']]));
    expect(jira.asked).toEqual([['LOAN-12', 'LOAN-999']]);
    const docs = await store.collection('deck_prs').find({}).toArray();
    const loan = docs.find(d => d.key === 'https://acme.atlassian.net/browse/LOAN-12')!;
    expect(loan).toMatchObject({ title: 'LOAN-12 Title LOAN-12', reference: 'https://acme.atlassian.net/browse/LOAN-12', deployDate: '2026-11-20', deployDateSource: 'project', owner: 'Ana' });
    expect((loan.prs as Array<{ number: number }>).map(p => p.number).sort()).toEqual([1, 2]);
    // An unknown key and a PR without a key stay on their own.
    expect(docs.map(d => d.key).sort()).toEqual(['https://acme.atlassian.net/browse/LOAN-12', 'https://github.com/acme/api/pull/3', 'https://github.com/acme/api/pull/4']);
    await store.close();
  });
});
