// "My queue" priority: item type (order set by the Tech Lead), then age.
// Default order: Ticket > Bug > Fix > Task > others. Configurable with QUEUE_TYPE_ORDER
// (groups separated by ";", synonyms by "|", case-insensitive).

export const DEFAULT_TYPE_ORDER = 'ticket|suporte|support;bug|defeito|production error|problem|erro;ajuste|ajustes|minor fix|fix;tarefa|task';

export interface TypeRule { label: string; patterns: string[] }

export function parseTypeOrder(raw: string = DEFAULT_TYPE_ORDER): TypeRule[] {
  return raw.split(';').map(g => g.split('|').map(s => s.trim().toLowerCase()).filter(Boolean))
    .filter(p => p.length > 0)
    .map(patterns => ({ label: patterns[0]!, patterns }));
}

/** Type rank (0 = highest priority). Unknown types come after all known ones. */
export function typeRank(rules: TypeRule[], ...hints: Array<string | undefined | null>): number {
  const text = hints.filter(Boolean).map(h => h!.toLowerCase());
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    if (text.some(t => rule.patterns.some(p => t === p || t.split(/[\s/:_-]+/).includes(p) || (p.includes(' ') && t.includes(p))))) return i;
  }
  return rules.length;
}

export interface Rankable { rank: number; createdAt: string | number }

/** Sorts by type priority and, within the same type, from oldest to newest. */
export function sortQueue<T extends Rankable>(items: T[]): T[] {
  const ts = (v: string | number) => (typeof v === 'number' ? v : Date.parse(v));
  return [...items].sort((a, b) => a.rank - b.rank || ts(a.createdAt) - ts(b.createdAt));
}
