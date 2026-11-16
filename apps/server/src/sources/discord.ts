// Discord via REST, somente leitura (GET de mensagens). Nunca envia nada.
import { z } from 'zod';

const API = 'https://discord.com/api/v10';
const DISCORD_EPOCH = 1_420_070_400_000n;

/** Snowflake mínimo para um instante (para paginar com ?after=). */
export const snowflakeAt = (ms: number) => ((BigInt(Math.floor(ms)) - DISCORD_EPOCH) << 22n).toString();

const Message = z.object({
  id: z.string(),
  channel_id: z.string(),
  author: z.object({ id: z.string(), username: z.string(), global_name: z.string().nullable().optional(), bot: z.boolean().optional() }),
  content: z.string(),
  timestamp: z.string(),
  mentions: z.array(z.object({ id: z.string() })).default([]),
  mention_roles: z.array(z.string()).default([]),
  message_reference: z.object({ message_id: z.string().optional() }).optional(),
});
export type DiscordMessage = z.infer<typeof Message>;

export class DiscordClient {
  constructor(private readonly token: string, private readonly guildId: string | undefined) {}

  messageUrl(channelId: string, id: string): string {
    return `https://discord.com/channels/${this.guildId ?? '@me'}/${channelId}/${id}`;
  }

  private async get(path: string, attempt = 0): Promise<unknown> {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bot ${this.token}`, 'User-Agent': 'agent-board-local (read-only)' },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429 && attempt < 2) {
      const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
      await new Promise(r => setTimeout(r, Math.min(10_000, (body.retry_after ?? 1) * 1000)));
      return this.get(path, attempt + 1);
    }
    if (res.status === 401) throw new Error('Discord recusou o token do bot (401)');
    if (res.status === 403) throw new Error('Bot sem permissão de leitura neste canal (403)');
    if (!res.ok) throw new Error(`Discord HTTP ${res.status}`);
    return res.json();
  }

  /** Mensagens do canal desde `sinceMs`, em ordem cronológica (até `max`). */
  async messagesSince(channelId: string, sinceMs: number, max = 1000): Promise<DiscordMessage[]> {
    const out: DiscordMessage[] = [];
    let after = snowflakeAt(sinceMs);
    while (out.length < max) {
      const page = z.array(Message).parse(await this.get(`/channels/${channelId}/messages?limit=100&after=${after}`));
      if (!page.length) break;
      page.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      out.push(...page);
      after = page[page.length - 1]!.id;
      if (page.length < 100) break;
    }
    return out;
  }
}
