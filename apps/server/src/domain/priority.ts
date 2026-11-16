// Prioridade da "Minha fila": tipo do item (ordem definida pelo Tech Lead) e depois idade.
// Ordem padrão: Ticket > Bug > Ajuste > Tarefa > demais. Configurável por QUEUE_TYPE_ORDER
// (grupos separados por ";", sinônimos por "|", sem diferenciar maiúsculas).

export const DEFAULT_TYPE_ORDER = 'ticket|suporte|support;bug|defeito;ajuste|ajustes|minor fix|fix;tarefa|task';

export interface TypeRule { label: string; patterns: string[] }

export function parseTypeOrder(raw: string = DEFAULT_TYPE_ORDER): TypeRule[] {
  return raw.split(';').map(g => g.split('|').map(s => s.trim().toLowerCase()).filter(Boolean))
    .filter(p => p.length > 0)
    .map(patterns => ({ label: patterns[0]!, patterns }));
}

/** Rank do tipo (0 = mais prioritário). Tipos desconhecidos ficam depois de todos os conhecidos. */
export function typeRank(rules: TypeRule[], ...hints: Array<string | undefined | null>): number {
  const text = hints.filter(Boolean).map(h => h!.toLowerCase());
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    if (text.some(t => rule.patterns.some(p => t === p || t.split(/[\s/:_-]+/).includes(p) || (p.includes(' ') && t.includes(p))))) return i;
  }
  return rules.length;
}

export interface Rankable { rank: number; createdAt: string | number }

/** Ordena por prioridade do tipo e, dentro do mesmo tipo, do mais antigo para o mais novo. */
export function sortQueue<T extends Rankable>(items: T[]): T[] {
  const ts = (v: string | number) => (typeof v === 'number' ? v : Date.parse(v));
  return [...items].sort((a, b) => a.rank - b.rank || ts(a.createdAt) - ts(b.createdAt));
}
