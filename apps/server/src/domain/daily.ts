// Daily do time: interpreta o formato do time e resume o dia.
// Formato esperado (com tolerância a variações):
//   Bom dia @equipe
//   ## Ontem - <dia> (YYYY-MM-DD)   -> itens
//   ## Hoje - <dia> (YYYY-MM-DD)    -> itens
//   ## Bloqueios                     -> "- nenhum" ou "- #123 descrição (desde 09:30) — depende de @pessoa"
//   Confiança: N/5
// Sem as seções explícitas, bloqueios são detectados por palavras-chave (fallback).

export interface DailyBlocker {
  text: string;
  issue?: string | undefined;
  since?: string | undefined;     // "HH:MM" como escrito
  dependsOn?: string | undefined; // "@pessoa"
  inferred: boolean;              // true = veio de palavra-chave, não da seção
}

export interface ParsedDaily {
  isDaily: boolean;
  yesterday: string[];
  today: string[];
  blockers: DailyBlocker[];
  confidence?: number | undefined;
}

const BLOCK_WORDS = /\b(bloquead[oa]s?|bloqueio|impedid[oa]|impedimento|travad[oa]|blocked|aguardando (?:acesso|retorno|aprova[cç][aã]o|libera[cç][aã]o|deploy)|depend(?:o|endo|e) d[eoa])\b/i;
const NONE = /^(nenhum|nenhuma|nada|n\/a|-|—|sem bloqueios?)\.?$/i;

const SECTION_WORD = /^(ontem|sexta(?:-feira)?|hoje|bloqueios?|impedimentos?)\b/i;

/**
 * Uma linha é cabeçalho de seção quando:
 *  - começa com "#" ("## Hoje - segunda-feira (2026-11-16)"), ou
 *  - está em negrito ("**Hoje**"), ou
 *  - é um rótulo curto seguido de ":" ("Ontem:", "Hoje (16/11):", "Bloqueios: nenhum").
 * Assim "Hoje vou corrigir o bug" (item sem marcador) não vira cabeçalho.
 */
function sectionOf(line: string): 'yesterday' | 'today' | 'blockers' | null {
  const t = line.trim();
  const isHeading = t.startsWith('#') || /^\*\*[^*]+\*\*:?$/.test(t) || /^[\p{L}\s-]{2,24}(?:\([^)]{0,24}\))?\s*:/u.test(t);
  if (!isHeading) return null;
  const h = t.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
  const m = h.match(SECTION_WORD);
  if (!m) return null;
  const w = m[1]!.toLowerCase();
  if (w.startsWith('ontem') || w.startsWith('sexta')) return 'yesterday';
  if (w === 'hoje') return 'today';
  return 'blockers';
}

const bullet = (l: string) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();

export function parseBlockerLine(raw: string, inferred = false): DailyBlocker {
  const text = bullet(raw);
  const issue = text.match(/#(\d+)/)?.[1];
  const since = text.match(/\(desde\s+(\d{1,2}[:h]\d{2})\)/i)?.[1]?.replace('h', ':');
  const dependsOn = text.match(/depende de\s+(@[\w.-]+|<@!?\d+>)/i)?.[1];
  return { text, issue, since, dependsOn, inferred };
}

export function parseDaily(content: string): ParsedDaily {
  const lines = content.split(/\r?\n/);
  const out: ParsedDaily = { isDaily: false, yesterday: [], today: [], blockers: [] };
  let section: 'yesterday' | 'today' | 'blockers' | null = null;
  let explicitBlockers = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const conf = trimmed.match(/^\**confian[cç]a\**\s*[:=-]\s*\**\s*([1-5])\s*(?:\/\s*5)?/i);
    if (conf) { out.confidence = Number(conf[1]); continue; }
    const sec = sectionOf(trimmed);
    if (sec) {
      section = sec;
      if (sec === 'blockers') explicitBlockers = true;
      // "Bloqueios: nenhum" na mesma linha
      const inline = trimmed.split(':').slice(1).join(':').trim();
      if (sec === 'blockers' && inline && !NONE.test(inline)) out.blockers.push(parseBlockerLine(inline));
      continue;
    }
    if (!section) continue;
    const item = bullet(trimmed);
    if (!item) continue;
    if (section === 'blockers') { if (!NONE.test(item) && !/^\(ou /i.test(item)) out.blockers.push(parseBlockerLine(trimmed)); }
    else out[section].push(item);
  }

  out.isDaily = out.yesterday.length > 0 || out.today.length > 0 || explicitBlockers || out.confidence !== undefined;
  if (!explicitBlockers) {
    for (const item of [...out.today, ...out.yesterday]) {
      if (BLOCK_WORDS.test(item)) out.blockers.push(parseBlockerLine(item, true));
    }
  }
  return out;
}

// ---------- Resumo do dia ----------

export interface DailyMessage { id: string; authorId: string; content: string; timestamp: string; url?: string | undefined }
export interface TeamMember { id: string; name: string }

export interface PersonDaily {
  member: TeamMember;
  posted: boolean;
  postedAt?: string | undefined;
  messageUrl?: string | undefined;
  parsed?: ParsedDaily | undefined;
  lowConfidence: boolean;
  /** Mudanças em relação à daily anterior da mesma pessoa. */
  changes: { newBlockers: DailyBlocker[]; resolvedBlockers: DailyBlocker[]; confidenceDelta?: number | undefined };
}

export interface DailySummary {
  day: string; // YYYY-MM-DD (fuso do time)
  people: PersonDaily[];
  missing: TeamMember[];
  lowConfidence: PersonDaily[];
  blockers: Array<{ member: TeamMember; blocker: DailyBlocker; messageUrl?: string | undefined }>;
  postedCount: number;
}

const blockerKey = (b: DailyBlocker) => (b.issue ? `#${b.issue}` : b.text.toLowerCase().replace(/\s+/g, ' ').slice(0, 60));

/** Dia local (YYYY-MM-DD) para um timestamp, dado o offset do fuso em minutos (BRT = -180). */
export const localDay = (iso: string | number, tzOffsetMin: number) =>
  new Date((typeof iso === 'number' ? iso : Date.parse(iso)) + tzOffsetMin * 60_000).toISOString().slice(0, 10);

/**
 * Junta as mensagens do canal da daily: para cada pessoa do time, a última daily de hoje
 * e a última de um dia anterior (para calcular o que mudou).
 */
export function summarizeDaily(messages: DailyMessage[], team: TeamMember[], now: number, tzOffsetMin = -180): DailySummary {
  const today = localDay(now, tzOffsetMin);
  const byAuthor = new Map<string, DailyMessage[]>();
  for (const m of messages) byAuthor.set(m.authorId, [...(byAuthor.get(m.authorId) ?? []), m]);

  const people: PersonDaily[] = team.map(member => {
    const msgs = (byAuthor.get(member.id) ?? [])
      .map(m => ({ m, parsed: parseDaily(m.content), day: localDay(m.timestamp, tzOffsetMin) }))
      .filter(x => x.parsed.isDaily)
      .sort((a, b) => Date.parse(b.m.timestamp) - Date.parse(a.m.timestamp));
    const current = msgs.find(x => x.day === today);
    const previous = msgs.find(x => x.day < today);
    if (!current) return { member, posted: false, lowConfidence: false, changes: { newBlockers: [], resolvedBlockers: [] } };

    const prevKeys = new Set(previous?.parsed.blockers.map(blockerKey) ?? []);
    const curKeys = new Set(current.parsed.blockers.map(blockerKey));
    const conf = current.parsed.confidence;
    const prevConf = previous?.parsed.confidence;
    return {
      member,
      posted: true,
      postedAt: current.m.timestamp,
      messageUrl: current.m.url,
      parsed: current.parsed,
      lowConfidence: conf !== undefined && conf <= 2,
      changes: {
        newBlockers: current.parsed.blockers.filter(b => !prevKeys.has(blockerKey(b))),
        resolvedBlockers: (previous?.parsed.blockers ?? []).filter(b => !curKeys.has(blockerKey(b))),
        confidenceDelta: conf !== undefined && prevConf !== undefined ? conf - prevConf : undefined,
      },
    };
  });

  return {
    day: today,
    people,
    missing: people.filter(p => !p.posted).map(p => p.member),
    lowConfidence: people.filter(p => p.lowConfidence),
    blockers: people.flatMap(p => (p.parsed?.blockers ?? []).map(blocker => ({ member: p.member, blocker, messageUrl: p.messageUrl }))),
    postedCount: people.filter(p => p.posted).length,
  };
}
