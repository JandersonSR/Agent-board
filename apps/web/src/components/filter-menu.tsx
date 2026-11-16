// Filtros por pessoa, time e repositório (mostrar só / ocultar), com atalhos para bots e os meus.
// Clique num valor: nada → mostrar só (✓) → ocultar (⊘) → nada.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ban, Check, Filter, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import {
  activeCount, EMPTY_FILTERS, isBot, nextState, setState, stateOf,
  type FacetKey, type Filters, type People,
} from '@/lib/filters';
import { k, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export const usePeople = () => useQuery({
  queryKey: ['people'],
  queryFn: () => api.get<People>('/api/github/people'),
  staleTime: 3_600_000,
});

export interface FacetOptions { author: Array<{ value: string; count: number }>; repo: Array<{ value: string; count: number }>; team?: Array<{ value: string; count: number }> }

const FACET_LABEL: Record<FacetKey, string> = { author: k('Pessoa'), team: k('Time'), repo: k('Repositório') };

function StateIcon({ state }: { state: 'none' | 'include' | 'exclude' }) {
  if (state === 'include') return <Check className="size-3.5 text-success" />;
  if (state === 'exclude') return <Ban className="size-3.5 text-danger" />;
  return <span className="size-3.5" />;
}

/** Times que aparecem nos itens (pelos autores) + times explícitos. */
function teamOptions(people: People | undefined, authors: FacetOptions['author'], explicit: FacetOptions['team'] = []) {
  const counts = new Map<string, number>();
  for (const tm of people?.teams ?? []) {
    const members = new Set(tm.members.map(m => m.toLowerCase()));
    const n = authors.filter(a => members.has(a.value.toLowerCase())).reduce((s, a) => s + a.count, 0);
    if (n) counts.set(tm.slug, n);
  }
  for (const e of explicit) counts.set(e.value, (counts.get(e.value) ?? 0) + e.count);
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function FilterMenu({ filters, onChange, options, align = 'end', size = 'xs' }: {
  filters: Filters; onChange: (f: Filters) => void; options: FacetOptions; align?: 'start' | 'end'; size?: 'xs' | 'sm';
}) {
  const people = usePeople().data;
  const teams = useMemo(() => teamOptions(people, options.author, options.team), [people, options.author, options.team]);
  const n = activeCount(filters);
  const lists: Record<FacetKey, Array<{ value: string; count: number }>> = { author: options.author, team: teams, repo: options.repo };
  const bots = options.author.filter(a => isBot(a.value)).reduce((s, a) => s + a.count, 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={size} variant={n ? 'secondary' : 'ghost'} aria-label={t('Filtros')}>
          <Filter /> {t('Filtros')}{n > 0 && <span className="rounded bg-primary px-1 text-[10px] text-primary-foreground tabular-nums">{n}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-64">
        <DropdownMenuCheckboxItem checked={filters.hideBots} onSelect={e => e.preventDefault()}
          onCheckedChange={v => onChange({ ...filters, hideBots: v === true })}>
          {t('Ocultar bots')} <span className="ml-auto text-[11px] text-muted-foreground">{bots || ''}</span>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={filters.hideMine} disabled={!people?.me} onSelect={e => e.preventDefault()}
          onCheckedChange={v => onChange({ ...filters, hideMine: v === true })}>
          {t('Ocultar os meus')} {people?.me && <span className="ml-auto truncate text-[11px] text-muted-foreground">{people.me}</span>}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {(['author', 'team', 'repo'] as const).map(key => (
          <DropdownMenuSub key={key}>
            <DropdownMenuSubTrigger disabled={!lists[key].length}>
              {t(FACET_LABEL[key])}
              {(filters[key].include.length + filters[key].exclude.length) > 0 && (
                <span className="ml-auto text-[11px] text-muted-foreground">{filters[key].include.length + filters[key].exclude.length}</span>
              )}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 w-64 overflow-auto">
              <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">{t('Clique: mostrar só · de novo: ocultar · de novo: limpar')}</DropdownMenuLabel>
              {lists[key].map(o => {
                const st = stateOf(filters, key, o.value);
                return (
                  <DropdownMenuItem key={o.value} onSelect={e => { e.preventDefault(); onChange(setState(filters, key, o.value, nextState(st))); }}
                    className={cn(st === 'exclude' && 'text-muted-foreground line-through')}>
                    <StateIcon state={st} />
                    <span className="min-w-0 flex-1 truncate">{key === 'repo' ? o.value.split('/').pop() : o.value}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">{o.count}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
        {n > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange({ ...EMPTY_FILTERS, text: filters.text })}><X /> {t('Limpar filtros')}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Etiquetas dos filtros ativos, com X para remover cada um. */
export function ActiveFilters({ filters, onChange, className }: { filters: Filters; onChange: (f: Filters) => void; className?: string }) {
  const chips: Array<{ id: string; label: string; exclude: boolean; remove: () => void }> = [];
  if (filters.hideBots) chips.push({ id: 'bots', label: t('sem bots'), exclude: true, remove: () => onChange({ ...filters, hideBots: false }) });
  if (filters.hideMine) chips.push({ id: 'mine', label: t('sem os meus'), exclude: true, remove: () => onChange({ ...filters, hideMine: false }) });
  for (const key of ['author', 'team', 'repo'] as const) {
    for (const v of filters[key].include) chips.push({ id: `${key}+${v}`, label: `${t(FACET_LABEL[key])}: ${key === 'repo' ? v.split('/').pop() : v}`, exclude: false, remove: () => onChange(setState(filters, key, v, 'none')) });
    for (const v of filters[key].exclude) chips.push({ id: `${key}-${v}`, label: `${t(FACET_LABEL[key])}: ${key === 'repo' ? v.split('/').pop() : v}`, exclude: true, remove: () => onChange(setState(filters, key, v, 'none')) });
  }
  if (!chips.length) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {chips.map(c => (
        <span key={c.id} className={cn('inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] ring-1 ring-inset',
          c.exclude ? 'bg-danger-soft text-danger ring-danger/20' : 'bg-success-soft text-success ring-success/20')}>
          {c.exclude ? <Ban className="size-3" /> : <Check className="size-3" />}{c.label}
          <button type="button" onClick={c.remove} aria-label={t('Remover filtro {name}', { name: c.label })} className="rounded hover:bg-background/50"><X className="size-3" /></button>
        </span>
      ))}
    </div>
  );
}

/** Busca por texto (título). */
export function FilterSearch({ filters, onChange, className }: { filters: Filters; onChange: (f: Filters) => void; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input value={filters.text} onChange={e => onChange({ ...filters, text: e.target.value })} placeholder={t('Buscar no título…')}
        aria-label={t('Buscar no título')} className="h-8 pl-7 text-xs" />
    </div>
  );
}
