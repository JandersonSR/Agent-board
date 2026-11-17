// Chat adapters with simulated API answers (no real calls).
import { describe, expect, it } from 'vitest';
import { answeredByMe, fromDiscord, normalizeSlackText, slackChat, slackMentions, slackTsToIso, titleOf, type ChatMessage } from './chat.js';

/** Fetcher that answers by Slack method and records the calls. */
function fakeSlack(routes: Record<string, unknown[]>) {
  const calls: string[] = [];
  const next = new Map(Object.entries(routes).map(([k, v]) => [k, [...v]]));
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push(url);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer xoxb-test');
    const method = new URL(url).pathname.split('/').pop()!;
    const queue = next.get(method) ?? [];
    const body = queue.length > 1 ? queue.shift() : queue[0];
    return new Response(JSON.stringify(body ?? { ok: false, error: 'unknown_method' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetcher, calls };
}

describe('Slack', () => {
  it('reads the channel with paging, names, mentions, threads and permalinks', async () => {
    const { fetcher, calls } = fakeSlack({
      'auth.test': [{ ok: true, url: 'https://acme.slack.com/' }],
      'conversations.history': [
        { ok: true, messages: [{ ts: '1731760000.000200', user: 'U2', text: '*Hoje*\n- corrigir <@U1> &amp; <!subteam^S9|@leads>', reply_users: ['U1'] }], has_more: true, response_metadata: { next_cursor: 'c2' } },
        { ok: true, messages: [{ ts: '1731750000.000100', user: 'U3', text: 'oi' }, { ts: '1731750001.000000', subtype: 'channel_join', user: 'U4', text: 'joined' }], has_more: false },
      ],
      'users.info': [{ ok: true, user: { id: 'U2', name: 'ana', profile: { display_name: 'Ana' } } }],
    });
    const msgs = await slackChat({ token: 'xoxb-test', fetcher }).messagesSince('C1', Date.parse('2026-11-10T00:00:00Z'));
    expect(msgs.map(m => m.id)).toEqual(['1731750000.000100', '1731760000.000200']); // oldest first, joins dropped
    const m = msgs[1]!;
    expect(m).toMatchObject({ authorName: 'Ana', mentions: ['U1'], groupMentions: ['S9'], replyUsers: ['U1'], url: 'https://acme.slack.com/archives/C1/p1731760000000200', isBot: false });
    expect(m.text).toBe('**Hoje**\n- corrigir <@U1> & <!subteam^S9|@leads>');
    expect(calls.some(c => c.includes('cursor=c2'))).toBe(true);
    expect(calls.find(c => c.includes('conversations.history'))).toContain('oldest=1794268800.000000');
  });

  it('a Slack error says what to do and never carries the token', async () => {
    const { fetcher } = fakeSlack({ 'auth.test': [{ ok: true, url: 'https://acme.slack.com/' }], 'conversations.history': [{ ok: false, error: 'not_in_channel' }] });
    await expect(slackChat({ token: 'xoxb-test', fetcher }).messagesSince('C1', 0)).rejects.toThrow(/not_in_channel \(invite the app to the channel\)/);
    await expect(slackChat({ token: 'xoxb-test', fetcher }).messagesSince('C1', 0)).rejects.not.toThrow(/xoxb/);
  });

  it('helpers: timestamps, mentions, mrkdwn and titles', () => {
    expect(slackTsToIso('1731760000.123456')).toBe('2024-11-16T12:26:40.123Z');
    expect(slackMentions('<@U1|ana> e <!subteam^S2>')).toEqual({ users: ['U1'], groups: ['S2'] });
    expect(normalizeSlackText('ver <https://x.dev/a|o doc> e *Bloqueios:* nenhum')).toBe('ver o doc (https://x.dev/a) e **Bloqueios:** nenhum');
    expect(titleOf('\n<@U1> pode olhar o deploy?\nmais')).toBe('pode olhar o deploy?');
  });
});

describe('Discord and the shared rules', () => {
  it('maps a Discord message', () => {
    const m = fromDiscord({
      id: '9', channel_id: 'c', author: { id: 'a', username: 'ana', global_name: 'Ana', bot: false }, content: 'oi <@1>', timestamp: '2026-11-16T10:00:00Z',
      mentions: [{ id: '1' }], mention_roles: ['r'], message_reference: { message_id: '8' },
    }, 'https://discord.com/x');
    expect(m).toMatchObject({ authorName: 'Ana', mentions: ['1'], groupMentions: ['r'], replyTo: '8', url: 'https://discord.com/x' });
  });

  it('answered: a reply, a thread answer or a later message of mine in the same channel', () => {
    const msg = (id: string, authorId: string, at: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
      id, channelId: 'c', authorId, authorName: authorId, isBot: false, text: '', at, url: '', mentions: [], groupMentions: [], ...extra,
    });
    const q = msg('1', 'ana', '2026-11-16T10:00:00Z');
    expect(answeredByMe(q, [q], 'me')).toBe(false);
    expect(answeredByMe(q, [q, msg('2', 'me', '2026-11-16T09:00:00Z')], 'me')).toBe(false);
    expect(answeredByMe(q, [q, msg('2', 'me', '2026-11-16T11:00:00Z')], 'me')).toBe(true);
    expect(answeredByMe({ ...q, replyUsers: ['me'] }, [q], 'me')).toBe(true);
    expect(answeredByMe(q, [q, msg('2', 'me', '2026-11-16T09:00:00Z', { replyTo: '1' })], 'me')).toBe(true);
  });
});
