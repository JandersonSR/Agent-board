// Feature RAGs: the state of each clone and a test search (the same one used in the session prompt).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpenText, CheckCircle2, Search, TriangleAlert, XCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Mono, Pill } from '@/components/common';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import { t } from '@/lib/i18n';

interface MapInfo { name: string; path: string; ok: boolean; error?: string; packs: number; remote?: string; lastCommit?: string; behind?: number; hasAgentsMd: boolean }
interface Hit { map: string; id: string; title: string; domain?: string; repos: string[]; summary: string; tokens: number; score: number; matched: string[] }

export function FeatMapsPanel() {
  const maps = useQuery({ queryKey: ['featmaps'], queryFn: () => api.get<{ maps: MapInfo[] }>('/api/featmaps') });
  const [q, setQ] = useState('');
  const [repo, setRepo] = useState('');
  const [submitted, setSubmitted] = useState<{ q: string; repo: string } | null>(null);
  const search = useQuery({
    queryKey: ['featmaps-search', submitted],
    queryFn: () => api.get<{ maps: string[]; hits: Hit[] }>(`/api/featmaps/search?q=${encodeURIComponent(submitted!.q)}${submitted!.repo ? `&repo=${encodeURIComponent(submitted!.repo)}` : ''}`),
    enabled: !!submitted && submitted.q.length >= 2,
  });

  return (
    <section className="rounded-xl border bg-card shadow-xs">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <BookOpenText className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t('Feature RAGs')}</h2>
        <span className="text-xs text-muted-foreground">{t('context for resolution sessions')}</span>
      </header>
      <ul className="divide-y">
        {maps.isLoading && <li className="p-4"><Skeleton className="h-10" /></li>}
        {maps.data?.maps.length === 0 && <li className="px-4 py-3 text-xs text-muted-foreground">{t('No RAG in')} <Mono>FEAT_MAPS</Mono>.</li>}
        {maps.data?.maps.map(m => (
          <li key={m.name} className="flex gap-3 px-4 py-3">
            {m.ok ? (m.behind ? <TriangleAlert className="mt-0.5 size-4 text-warning" /> : <CheckCircle2 className="mt-0.5 size-4 text-success" />) : <XCircle className="mt-0.5 size-4 text-danger" />}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">{m.name} {m.ok && <Pill>{m.packs} packs</Pill>}</p>
              <p className="truncate text-xs text-muted-foreground">{m.remote ?? m.path}</p>
              <p className="text-xs text-muted-foreground">
                {m.ok ? <>{t('last commit {time} ago', { time: m.lastCommit ? ago(Date.parse(m.lastCommit)) : '?' })}{m.behind ? <span className="text-warning"> · {t('{n} commits behind (git pull)', { n: m.behind })}</span> : ''}{!m.hasAgentsMd && ` · ${t('no AGENTS.md')}`}</> : <span className="text-danger">{m.error}</span>}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <form className="space-y-2 border-t px-4 py-3" onSubmit={e => { e.preventDefault(); setSubmitted({ q: q.trim(), repo: repo.trim() }); }}>
        <p className="text-xs font-medium">{t('Test search')}</p>
        <div className="flex gap-2">
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder={t('Title or text of an item…')} className="h-8 text-xs" aria-label={t('Text to search')} />
          <Input value={repo} onChange={e => setRepo(e.target.value)} placeholder={t('repo (optional)')} className="h-8 w-36 font-mono text-xs" aria-label={t('Target repository')} />
          <button type="submit" className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs hover:bg-accent"><Search className="size-3.5" /> {t('Search')}</button>
        </div>
        {search.data && (
          <div className="space-y-1.5 pt-1">
            <p className="text-[11px] text-muted-foreground">{t('RAGs searched: {list}', { list: search.data.maps.join(', ') || '—' })}</p>
            {search.data.hits.length === 0 && <p className="text-xs text-muted-foreground">{t('No relevant feature.')}</p>}
            {search.data.hits.map(h => (
              <div key={`${h.map}:${h.id}`} className="rounded-lg border px-2.5 py-2">
                <p className="flex items-center gap-1.5 text-xs">
                  <Pill tone="info">{h.map}</Pill><Mono className="text-[11px]">{h.id}</Mono>
                  <span className="truncate font-medium">{h.title}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">~{h.tokens} tok · {h.score} pts</span>
                </p>
                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{h.summary}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{t('matched on: {list}', { list: h.matched.join(', ') })}</p>
              </div>
            ))}
          </div>
        )}
        {search.error && <p className="text-xs text-danger">{(search.error as Error).message}</p>}
      </form>
    </section>
  );
}
