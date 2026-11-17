// Team chat as one read-only source: the daily channel, watched channels and mentions of me.
// Adapters (Discord, Slack) turn each provider's messages into ChatMessage; the rest of the deck
// never sees provider-specific shapes. Nothing is ever posted.
import { z } from 'zod';
import { getJson, HttpError, type Fetcher } from '../util/http.js';
import { DiscordClient, type DiscordMessage } from './discord.js';

export type ChatProvider = 'discord' | 'slack';

export interface ChatMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  isBot: boolean;
  /** Plain text, with the provider's formatting normalized (bold as **x**). */
  text: string;
  /** ISO time. */
  at: string;
  url: string;
  /** User ids mentioned. */
  mentions: string[];
  /** Group/role ids mentioned (Discord roles, Slack user groups). */
  groupMentions: string[];
  /** Id of the message this one replies to (Discord replies). */
  replyTo?: string | undefined;
  /** Who answered in the thread (Slack threads). */
  replyUsers?: string[] | undefined;
}

export interface ChatSource {
  readonly provider: ChatProvider;
  readonly label: string;
  /** Channel messages since `sinceMs`, oldest first (up to `max`). */
  messagesSince(channelId: string, sinceMs: number, max?: number): Promise<ChatMessage[]>;
}

export interface ChatSettings {
  dailyChannelId?: string | undefined;
  watchChannels: Array<{ label: string; id: string }>;
  myUserId?: string | undefined;
  myGroupIds: string[];
  team: Array<{ id: string; name: string }>;
}

// ---------- Discord ----------
export const fromDiscord = (m: DiscordMessage, url: string): ChatMessage => ({
  id: m.id, channelId: m.channel_id, authorId: m.author.id, authorName: m.author.global_name ?? m.author.username, isBot: !!m.author.bot,
  text: m.content, at: m.timestamp, url, mentions: m.mentions.map(x => x.id), groupMentions: m.mention_roles,
  replyTo: m.message_reference?.message_id,
});

export function discordChat(token: string, guildId: string | undefined): ChatSource {
  const client = new DiscordClient(token, guildId);
  return {
    provider: 'discord', label: 'Discord',
    async messagesSince(channelId, sinceMs, max) {
      return (await client.messagesSince(channelId, sinceMs, max)).map(m => fromDiscord(m, client.messageUrl(m.channel_id, m.id)));
    },
  };
}

// ---------- Slack ----------
const SlackOk = z.object({ ok: z.boolean(), error: z.string().optional() }).passthrough();
const SlackMessage = z.object({
  ts: z.string(), text: z.string().default(''), user: z.string().optional(), bot_id: z.string().optional(), subtype: z.string().optional(),
  reply_users: z.array(z.string()).optional(), username: z.string().optional(),
});
const History = SlackOk.extend({
  messages: z.array(SlackMessage).default([]), has_more: z.boolean().optional(),
  response_metadata: z.object({ next_cursor: z.string().optional() }).optional(),
});
const UserInfo = SlackOk.extend({ user: z.object({ id: z.string(), name: z.string(), real_name: z.string().optional(), is_bot: z.boolean().optional(), profile: z.object({ display_name: z.string().optional(), real_name: z.string().optional() }).optional() }).optional() });
const AuthTest = SlackOk.extend({ url: z.string().optional() });

/** Slack timestamps ("1731700000.123456") → ISO; and back, for ?oldest=. */
export const slackTsToIso = (ts: string) => new Date(Number(ts.split('.')[0]) * 1000 + Number((ts.split('.')[1] ?? '0').slice(0, 3))).toISOString();
export const msToSlackTs = (ms: number) => (ms / 1000).toFixed(6);

/** Slack mrkdwn → the plain shape the deck parses: entities decoded, *bold* as **bold**, links as their text. */
export function normalizeSlackText(text: string): string {
  return text
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s:).,!?]|$)/gm, '$1**$2**')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export const slackMentions = (text: string) => ({
  users: [...text.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g)].map(m => m[1]!),
  groups: [...text.matchAll(/<!subteam\^([A-Z0-9]+)(?:\|[^>]*)?>/g)].map(m => m[1]!),
});

export interface SlackOptions { token: string; fetcher?: Fetcher | undefined }

export function slackChat(opts: SlackOptions): ChatSource {
  const fetcher = opts.fetcher ?? fetch;
  const auth = { Authorization: `Bearer ${opts.token}` };
  const names = new Map<string, string>();
  let workspaceUrl: string | undefined;

  async function api<T extends { ok: boolean; error?: string | undefined }>(method: string, params: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
    const url = `https://slack.com/api/${method}?${new URLSearchParams(params)}`;
    const r = await getJson(fetcher, url, auth, schema);
    if (!r.ok) {
      const scope = ['invalid_auth', 'not_authed', 'missing_scope', 'not_in_channel', 'account_inactive', 'token_revoked'].includes(r.error ?? '');
      throw new HttpError(`slack.com: ${r.error ?? 'error'}${r.error === 'not_in_channel' ? ' (invite the app to the channel)' : ''}`, scope ? 403 : undefined);
    }
    return r;
  }

  async function nameOf(userId: string): Promise<string> {
    const cached = names.get(userId);
    if (cached) return cached;
    const name = await api('users.info', { user: userId }, UserInfo)
      .then(r => r.user?.profile?.display_name || r.user?.real_name || r.user?.name || userId)
      .catch(() => userId);
    names.set(userId, name);
    return name;
  }

  return {
    provider: 'slack', label: 'Slack',
    async messagesSince(channelId, sinceMs, max = 1000) {
      workspaceUrl ??= (await api('auth.test', {}, AuthTest)).url?.replace(/\/?$/, '/') ?? 'https://slack.com/';
      const raw: Array<z.infer<typeof SlackMessage>> = [];
      let cursor = '';
      while (raw.length < max) {
        const page = await api('conversations.history', { channel: channelId, oldest: msToSlackTs(sinceMs), limit: '200', ...(cursor ? { cursor } : {}) }, History);
        raw.push(...page.messages);
        cursor = page.response_metadata?.next_cursor ?? '';
        if (!page.has_more || !cursor) break;
      }
      const kept = raw.filter(m => !m.subtype || m.subtype === 'bot_message' || m.subtype === 'thread_broadcast').slice(0, max);
      const out: ChatMessage[] = [];
      for (const m of kept.sort((a, b) => Number(a.ts) - Number(b.ts))) {
        const authorId = m.user ?? m.bot_id ?? 'unknown';
        const { users, groups } = slackMentions(m.text);
        out.push({
          id: m.ts, channelId, authorId, authorName: m.user ? await nameOf(m.user) : (m.username ?? 'bot'), isBot: !m.user || !!m.bot_id,
          text: normalizeSlackText(m.text), at: slackTsToIso(m.ts), url: `${workspaceUrl}archives/${channelId}/p${m.ts.replace('.', '')}`,
          mentions: users, groupMentions: groups, replyUsers: m.reply_users,
        });
      }
      return out;
    },
  };
}

/** Whether I already answered a message that mentions me: a reply to it, a thread answer, or a later message of mine in the channel. */
export function answeredByMe(m: ChatMessage, all: ChatMessage[], myId: string): boolean {
  if (m.replyUsers?.includes(myId)) return true;
  return all.some(x => x.authorId === myId && x.channelId === m.channelId && (x.replyTo === m.id || Date.parse(x.at) > Date.parse(m.at)));
}

/** First line of a message without mention markup, for queue titles. */
export const titleOf = (text: string) =>
  (text.split(/\r?\n/).find(l => l.trim()) ?? '').replace(/<@[!&]?[\dA-Z]+(?:\|[^>]*)?>|<!subteam\^[A-Z0-9]+(?:\|[^>]*)?>/g, '').trim().slice(0, 160);
