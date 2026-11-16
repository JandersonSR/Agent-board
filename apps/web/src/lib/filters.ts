// Filtros de PRs, reviews e fila: por pessoa, time e repositório, cada um com "mostrar só" (incluir)
// e "ocultar" (excluir), mais atalhos para ocultar bots e os meus. Puro e testável.
//
// Itens com vários autores (ex.: uma issue de deploy com PRs de várias pessoas):
// - incluir: basta UM autor/time/repo casar;
// - ocultar: o item só some quando TODOS os autores/times/repos dele estão ocultos.
import { useCallback, useState } from 'react';
import { readPref, writePref } from './prefs';

export interface Facet { include: string[]; exclude: string[] }
export interface Filters { author: Facet; team: Facet; repo: Facet; hideBots: boolean; hideMine: boolean; text: string }
export type FacetKey = 'author' | 'team' | 'repo';
export type FacetState = 'none' | 'include' | 'exclude';

export const EMPTY_FILTERS: Filters = {
  author: { include: [], exclude: [] }, team: { include: [], exclude: [] }, repo: { include: [], exclude: [] },
  hideBots: false, hideMine: false, text: '',
};

export interface Filterable {
  authors: Array<string | null | undefined>;
  repos: Array<string | null | undefined>;
  /** Times explícitos do item (ex.: time editado na issue de deploy). */
  teams?: Array<string | null | undefined>;
  text: string;
}

export interface People { me: string | null; teams: Array<{ slug: string; name: string; members: string[] }> }

const norm = (s: string) => s.trim().toLowerCase();
const clean = (xs: Array<string | null | undefined>) => [...new Set(xs.filter((x): x is string => !!x && !!x.trim()).map(norm))];

export function isBot(login: string): boolean {
  return /\[bot\]$|^(dependabot|renovate|github-actions|snyk-bot|codecov)\b|-bot$/i.test(login.trim());
}

/** Times (slug) de cada login, a partir dos times da org. */
export function teamIndex(people: People | undefined): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const t of people?.teams ?? []) for (const m of t.members) idx.set(norm(m), [...(idx.get(norm(m)) ?? []), norm(t.slug)]);
  return idx;
}

function facetPass(values: string[], f: Facet): boolean {
  const inc = f.include.map(norm);
  const exc = f.exclude.map(norm);
  if (inc.length && !values.some(v => inc.includes(v))) return false;
  if (exc.length && values.length && values.every(v => exc.includes(v))) return false;
  return true;
}

export function matches(item: Filterable, f: Filters, people?: People, idx = teamIndex(people)): boolean {
  const authors = clean(item.authors);
  const me = people?.me ? norm(people.me) : null;
  let visible = authors;
  if (f.hideBots) visible = visible.filter(a => !isBot(a));
  if (f.hideMine && me) visible = visible.filter(a => a !== me);
  // Todos os autores eram bots/eu: some.
  if (authors.length && !visible.length) return false;

  if (!facetPass(visible, f.author)) return false;

  // Time: o item "pertence" aos times dos autores visíveis + times explícitos.
  const teamsByAuthor = visible.map(a => idx.get(a) ?? []);
  const itemTeams = clean([...(item.teams ?? []), ...teamsByAuthor.flat()]);
  const tInc = f.team.include.map(norm);
  if (tInc.length && !itemTeams.some(t => tInc.includes(t))) return false;
  const tExc = f.team.exclude.map(norm);
  if (tExc.length) {
    // Oculta quando todo autor visível está num time oculto (e os times explícitos também).
    const authorHidden = (ts: string[]) => ts.some(t => tExc.includes(t));
    const explicit = clean(item.teams ?? []);
    const allAuthorsHidden = teamsByAuthor.length > 0 && teamsByAuthor.every(authorHidden);
    const explicitHidden = explicit.length > 0 && explicit.every(t => tExc.includes(t));
    if ((teamsByAuthor.length ? allAuthorsHidden : true) && (explicit.length ? explicitHidden : teamsByAuthor.length > 0)) return false;
  }

  if (!facetPass(clean(item.repos), f.repo)) return false;

  const q = norm(f.text);
  if (q && !norm(item.text).includes(q)) return false;
  return true;
}

export function applyFilters<T>(items: T[], toFilterable: (x: T) => Filterable, f: Filters, people?: People): T[] {
  if (isEmpty(f)) return items;
  const idx = teamIndex(people);
  return items.filter(x => matches(toFilterable(x), f, people, idx));
}

export function isEmpty(f: Filters): boolean { return activeCount(f) === 0 && !f.text.trim(); }

export function activeCount(f: Filters): number {
  return (['author', 'team', 'repo'] as const).reduce((n, k) => n + f[k].include.length + f[k].exclude.length, 0)
    + Number(f.hideBots) + Number(f.hideMine);
}

export function stateOf(f: Filters, key: FacetKey, value: string): FacetState {
  const v = norm(value);
  if (f[key].include.some(x => norm(x) === v)) return 'include';
  if (f[key].exclude.some(x => norm(x) === v)) return 'exclude';
  return 'none';
}

/** Define o estado de um valor (sai das duas listas e entra na escolhida). */
export function setState(f: Filters, key: FacetKey, value: string, state: FacetState): Filters {
  const v = norm(value);
  const without = (xs: string[]) => xs.filter(x => norm(x) !== v);
  const facet = { include: without(f[key].include), exclude: without(f[key].exclude) };
  if (state === 'include') facet.include.push(value);
  if (state === 'exclude') facet.exclude.push(value);
  return { ...f, [key]: facet };
}

/** Ciclo do clique: nada → mostrar só → ocultar → nada. */
export const nextState = (s: FacetState): FacetState => (s === 'none' ? 'include' : s === 'include' ? 'exclude' : 'none');

/** Valores presentes nos itens, com contagem, para montar os menus. */
export function facetValues<T>(items: T[], pick: (x: T) => Array<string | null | undefined>): Array<{ value: string; count: number }> {
  const counts = new Map<string, { value: string; count: number }>();
  for (const it of items) {
    for (const v of new Set(pick(it).filter((x): x is string => !!x))) {
      const key = norm(v);
      const cur = counts.get(key) ?? { value: v, count: 0 };
      cur.count++;
      counts.set(key, cur);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Filtros salvos por tela (no navegador). */
export function useFilters(scope: string): [Filters, (f: Filters) => void] {
  const [value, setValue] = useState<Filters>(() => {
    try { return { ...EMPTY_FILTERS, ...(JSON.parse(readPref(`filters.${scope}`, '{}')) as Partial<Filters>) }; } catch { return EMPTY_FILTERS; }
  });
  const set = useCallback((f: Filters) => { writePref(`filters.${scope}`, JSON.stringify({ ...f, text: '' })); setValue(f); }, [scope]);
  return [value, set];
}
