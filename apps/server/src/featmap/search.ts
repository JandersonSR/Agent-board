// Busca de features relevantes para um item (texto + repo alvo), com orçamento de tokens.
// Lexical e determinística de propósito: rápida, explicável ("casou em: título, repos") e testável.
import type { FeatHit, FeatPack } from './types.js';

const STOP = new Set([
  'a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'para', 'por', 'com',
  'sem', 'que', 'se', 'ao', 'aos', 'the', 'and', 'for', 'with', 'from', 'not', 'bug', 'fix', 'erro', 'error', 'ajuste',
  'feature', 'task', 'tarefa', 'issue', 'quando', 'nao', 'mais', 'esta', 'esse', 'essa', 'isso', 'via', 'ser', 'tem',
]);

export function tokenize(text: string): string[] {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
}

const FIELD_WEIGHT = { id: 4, title: 3, keywords: 2, domain: 2, repos: 2, summary: 1 } as const;
type Field = keyof typeof FIELD_WEIGHT;

function fieldTokens(p: FeatPack): Record<Field, Set<string>> {
  return {
    id: new Set(tokenize(`${p.id} ${p.slug ?? ''}`)),
    title: new Set(tokenize(p.title)),
    keywords: new Set(tokenize(p.keywords.join(' '))),
    domain: new Set(tokenize(p.domain ?? '')),
    repos: new Set(tokenize(p.repos.join(' ').replace(/\bREPO-/g, ''))),
    summary: new Set(tokenize(p.summary)),
  };
}

/** Normaliza "core", "REPO-CORE", "beta-worker" para comparar com pack.repos. */
const repoKey = (s: string) => s.toUpperCase().replace(/^REPO-/, '').replace(/[^A-Z0-9]+/g, '-');

/** Glob simples (* e ?) sem diferenciar maiúsculas. */
export function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
  return re.test(value);
}

/**
 * Quais RAGs valem para um repo alvo:
 * - RAGs com rota só valem para repos que casam com a rota;
 * - se o repo casa com alguma rota, usa só esses RAGs;
 * - senão, usa os RAGs sem rota. Sem repo: todos.
 */
export function mapsForRepo(all: string[], routes: Array<{ name: string; patterns: string[] }>, repo?: string): string[] {
  if (!repo) return all;
  const routed = new Set(routes.map(r => r.name));
  const hit = routes.filter(r => r.patterns.some(p => globMatch(p, repo))).map(r => r.name).filter(n => all.includes(n));
  return hit.length ? hit : all.filter(n => !routed.has(n));
}

export interface SearchOptions { repo?: string | undefined; maps?: string[] | undefined; limit?: number; tokenBudget?: number }

export function searchPacks(packs: FeatPack[], query: string, opts: SearchOptions = {}): FeatHit[] {
  const q = [...new Set(tokenize(query))];
  if (!q.length) return [];
  const allowed = opts.maps ? new Set(opts.maps) : undefined;
  const target = opts.repo ? repoKey(opts.repo) : undefined;

  const hits: FeatHit[] = [];
  for (const p of packs) {
    if (allowed && !allowed.has(p.map)) continue;
    const f = fieldTokens(p);
    let score = 0;
    const matched = new Set<string>();
    for (const t of q) {
      for (const field of Object.keys(FIELD_WEIGHT) as Field[]) {
        if (f[field].has(t) || (t.length >= 5 && [...f[field]].some(x => x.startsWith(t) || t.startsWith(x) && x.length >= 5))) {
          score += FIELD_WEIGHT[field];
          matched.add(field);
        }
      }
    }
    // O repo alvo só reforça um pack que já casou com o texto; sozinho não basta.
    if (score === 0) continue;
    if (target && p.repos.some(r => repoKey(r) === target)) { score += 3; matched.add('repo alvo'); }
    hits.push({ pack: p, score, matched: [...matched] });
  }
  hits.sort((a, b) => b.score - a.score || a.pack.tokens - b.pack.tokens);
  // Descarta cauda fraca: abaixo de 35% do melhor (mínimo 3 pontos).
  const floor = Math.max(3, (hits[0]?.score ?? 0) * 0.35);
  const strong = hits.filter(h => h.score >= floor);

  const limit = opts.limit ?? 5;
  const budget = opts.tokenBudget ?? Infinity;
  const out: FeatHit[] = [];
  let used = 0;
  for (const h of strong) {
    if (out.length >= limit) break;
    if (used + h.pack.tokens > budget && out.length > 0) continue;
    out.push(h);
    used += h.pack.tokens;
  }
  return out;
}
