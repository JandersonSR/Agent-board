// The team's open blockers: who is stuck, for how long and on which task.
// Sources: (1) the "Blockers" section of the dailies — a blocker is open while it shows up in the
// person's latest daily; "since" = the first consecutive daily where it appeared (or the
// "(since HH:MM)" written); (2) messages in the watched channels with blocker words,
// closed when the author later writes a resolution message.
import { localDay, parseDaily, type DailyBlocker, type DailyMessage, type TeamMember } from './daily.js';

export interface OpenBlocker {
  key: string;
  member: TeamMember;
  text: string;
  issue?: string | undefined;
  dependsOn?: string | undefined;
  since: string;        // ISO
  ageMs: number;
  source: 'daily' | 'channel';
  inferred: boolean;
  messageUrl?: string | undefined;
  channel?: string | undefined;
}

const keyOf = (b: Pick<DailyBlocker, 'issue' | 'text'>) =>
  b.issue ? `#${b.issue}` : b.text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').slice(0, 50);

/** Converts a written "HH:MM" on the message's local day to ISO (team time zone). */
function sinceFromText(hhmm: string, messageIso: string, tzOffsetMin: number): string | undefined {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const day = localDay(messageIso, tzOffsetMin);
  const utc = Date.parse(`${day}T${m[1]!.padStart(2, '0')}:${m[2]}:00Z`) - tzOffsetMin * 60_000;
  return Number.isFinite(utc) && utc <= Date.parse(messageIso) ? new Date(utc).toISOString() : undefined;
}

export function blockersFromDailies(messages: DailyMessage[], team: TeamMember[], now: number, tzOffsetMin = -180): OpenBlocker[] {
  const out: OpenBlocker[] = [];
  for (const member of team) {
    const dailies = messages
      .filter(m => m.authorId === member.id)
      .map(m => ({ m, d: parseDaily(m.content) }))
      .filter(x => x.d.isDaily)
      .sort((a, b) => Date.parse(a.m.timestamp) - Date.parse(b.m.timestamp));
    const latest = dailies[dailies.length - 1];
    if (!latest) continue;

    for (const b of latest.d.blockers) {
      const key = keyOf(b);
      // Walks back through the history while the person kept reporting the same blocker.
      let first = latest;
      for (let i = dailies.length - 2; i >= 0; i--) {
        const prev = dailies[i]!;
        if (prev.d.blockers.some(x => keyOf(x) === key)) first = prev; else break;
      }
      const firstBlocker = first.d.blockers.find(x => keyOf(x) === key) ?? b;
      const since = (firstBlocker.since && sinceFromText(firstBlocker.since, first.m.timestamp, tzOffsetMin)) ?? first.m.timestamp;
      out.push({
        key: `${member.id}:${key}`, member, text: b.text, issue: b.issue, dependsOn: b.dependsOn,
        since, ageMs: Math.max(0, now - Date.parse(since)), source: 'daily', inferred: b.inferred, messageUrl: latest.m.url,
      });
    }
  }
  return out;
}

const BLOCK_WORDS = /\b(bloquead[oa]s?|bloqueio|impedid[oa]|travad[oa]|blocked|n[aã]o consigo (?:acessar|subir|rodar)|sem acesso)\b/i;
const RESOLVED_WORDS = /\b(resolvid[oa]|desbloquead[oa]|destravad[oa]|consegui|funcionou|ok agora|resolved|unblocked)\b/i;

export interface ChannelMessage extends DailyMessage { channel: string }

export function blockersFromChannels(messages: ChannelMessage[], team: TeamMember[], now: number, maxAgeMs = 24 * 3_600_000): OpenBlocker[] {
  const members = new Map(team.map(t => [t.id, t]));
  const sorted = [...messages].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const out: OpenBlocker[] = [];
  sorted.forEach((m, i) => {
    const member = members.get(m.authorId);
    if (!member || !BLOCK_WORDS.test(m.content)) return;
    if (now - Date.parse(m.timestamp) > maxAgeMs) return;
    const resolved = sorted.slice(i + 1).some(n => n.authorId === m.authorId && n.channel === m.channel && RESOLVED_WORDS.test(n.content));
    if (resolved) return;
    const text = m.content.split(/\r?\n/).find(l => BLOCK_WORDS.test(l))?.trim().slice(0, 200) ?? m.content.slice(0, 200);
    out.push({
      key: `${m.authorId}:ch:${m.id}`, member, text, issue: m.content.match(/#(\d+)/)?.[1],
      since: m.timestamp, ageMs: now - Date.parse(m.timestamp), source: 'channel', inferred: true, messageUrl: m.url, channel: m.channel,
    });
  });
  return out;
}

/** Merges the sources, removes duplicates (same person + same issue) and sorts from the oldest. */
export function mergeBlockers(...lists: OpenBlocker[][]): OpenBlocker[] {
  const seen = new Map<string, OpenBlocker>();
  for (const b of lists.flat()) {
    const k = b.issue ? `${b.member.id}:#${b.issue}` : b.key;
    const prev = seen.get(k);
    if (!prev || Date.parse(b.since) < Date.parse(prev.since)) seen.set(k, prev ? { ...b, source: prev.source === 'daily' ? 'daily' : b.source } : b);
  }
  return [...seen.values()].sort((a, b) => b.ageMs - a.ageMs);
}
