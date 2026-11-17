// Finds the features relevant to an item (text + target repo), within a token budget.
// Lexical and deterministic on purpose: fast, explainable ("matched on: title, repos") and testable.
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

/** Normalizes "core", "REPO-CORE", "beta-worker" to compare with pack.repos. */
const repoKey = (s: string) => s.toUpperCase().replace(/^REPO-/, '').replace(/[^A-Z0-9]+/g, '-');

/** Simple glob (* and ?), case-insensitive. */
export function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
  return re.test(value);
}

/**
 * Which RAGs apply to a target repo:
 * - RAGs with a route only apply to repos matching the route;
 * - if the repo matches some route, only those RAGs are used;
 * - otherwise, the RAGs without a route are used. No repo: all of them.
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
    // The target repo only boosts a pack that already matched the text; on its own it is not enough.
    if (score === 0) continue;
    if (target && p.repos.some(r => repoKey(r) === target)) { score += 3; matched.add('repo alvo'); }
    hits.push({ pack: p, score, matched: [...matched] });
  }
  hits.sort((a, b) => b.score - a.score || a.pack.tokens - b.pack.tokens);
  // Drops the weak tail: below 35% of the best (minimum 3 points).
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
