// Concentração de conhecimento: onde o time depende de uma ou duas pessoas para escrever ou revisar.
import { Info, Users } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, Mono, Pill, type Tone } from '@/components/common';
import { useKnowledge, type KnowledgeRisk, type RepoKnowledge } from '@/hooks/use-staff';
import { k, t } from '@/lib/i18n';
import { usePref } from '@/lib/prefs';
import { pct, Tile } from './shared';

const RANGES = ['30', '90', '180'] as const;
type Range = (typeof RANGES)[number];
const RISK: Record<KnowledgeRisk, { label: string; tone: Tone }> = {
  high: { label: k('risco alto'), tone: 'danger' }, medium: { label: k('risco médio'), tone: 'warning' }, low: { label: k('risco baixo'), tone: 'success' },
};

function People({ list, total }: { list: Array<{ name: string; prs: number }>; total: number }) {
  if (!list.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {list.slice(0, 4).map(p => <span key={p.name}>{p.name} <span className="text-muted-foreground tabular-nums">{Math.round((p.prs / Math.max(1, total)) * 100)}%</span></span>)}
      {list.length > 4 && <span className="text-muted-foreground">+{list.length - 4}</span>}
    </span>
  );
}

function RepoRow({ r }: { r: RepoKnowledge }) {
  const reviewed = r.prs - r.unknownReviewers - r.unreviewed;
  return (
    <tr className="border-b align-top last:border-0">
      <td className="px-4 py-2"><Mono className="text-[12px]">{r.repo}</Mono></td>
      <td className="px-4 py-2"><Pill tone={r.lowData ? 'neutral' : RISK[r.risk].tone}>{t(r.lowData ? 'poucos dados' : RISK[r.risk].label)}</Pill></td>
      <td className="px-4 py-2 text-right tabular-nums">{r.busFactor}</td>
      <td className="px-4 py-2 text-right tabular-nums">{r.prs}</td>
      <td className="px-4 py-2"><People list={r.authors} total={r.prs} /></td>
      <td className="px-4 py-2"><People list={r.reviewers} total={reviewed} /></td>
      <td className="px-4 py-2 text-right tabular-nums">{r.unreviewed ? <span className="text-warning">{r.unreviewed}</span> : '—'}</td>
    </tr>
  );
}

export function KnowledgeView() {
  const [range, setRange] = usePref<Range>('metrics.knowledge.range', '90');
  const q = useKnowledge(range);
  const d = q.data;
  const high = d?.repos.filter(r => !r.lowData && r.risk === 'high').length ?? 0;
  const sole = d?.people.filter(p => p.soleReviewerOf.length) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('Período')}</span>
        <Tabs value={range} onValueChange={v => setRange(v as Range)}>
          <TabsList>{RANGES.map(r => <TabsTrigger key={r} value={r}>{t('{n} dias', { n: r })}</TabsTrigger>)}</TabsList>
        </Tabs>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground lg:ml-auto">
          <Info className="size-3.5" /> {t('Fator de ônibus: quantas pessoas precisam sair para mais da metade dos PRs ficar sem ninguém que escreveu ou revisou.')}
        </p>
      </div>

      {q.isLoading && <Skeleton className="h-64" />}
      {q.error && <p className="text-sm text-danger">{(q.error as Error).message}</p>}
      {d && !d.configured && <div className="rounded-xl border border-dashed"><EmptyState icon={Users} title={t('MongoDB não configurado')} description={t('A concentração de conhecimento vem dos PRs acompanhados em PRs e deploy.')} /></div>}
      {d?.configured && !d.prs && <div className="rounded-xl border border-dashed"><EmptyState icon={Users} title={t('Ainda sem PRs mergeados no período')} /></div>}
      {d?.configured && d.prs > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={t('Repositórios com risco alto')} value={String(high)} sub={t('de {n} com dados suficientes', { n: d.repos.filter(r => !r.lowData).length })} />
            <Tile label={t('Revisor quase único')} value={String(sole.length)} sub={sole.length ? sole.slice(0, 3).map(p => p.name).join(', ') : t('ninguém')} />
            <Tile label={t('PRs mergeados')} value={String(d.prs)} sub={t('em {n} repositórios', { n: d.repos.length })} />
            <Tile label={t('Com dados de revisores')} value={pct(d.prs ? d.withReviewerData / d.prs : null)} sub={t('PRs antigos não têm essa informação')} />
          </div>

          <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
            <h3 className="border-b px-4 py-3 text-sm font-semibold">{t('Por repositório')}</h3>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground"><tr className="border-b text-left">
                  <th className="px-4 py-2 font-medium">{t('Repositório')}</th><th className="px-4 font-medium">{t('Risco')}</th>
                  <th className="px-4 text-right font-medium">{t('Fator de ônibus')}</th><th className="px-4 text-right font-medium">PRs</th>
                  <th className="px-4 font-medium">{t('Quem escreve')}</th><th className="px-4 font-medium">{t('Quem revisa')}</th>
                  <th className="px-4 text-right font-medium">{t('Sem review')}</th>
                </tr></thead>
                <tbody>{d.repos.map(r => <RepoRow key={r.repo} r={r} />)}</tbody>
              </table>
            </div>
          </section>

          {sole.length > 0 && (
            <section className="rounded-xl border bg-card p-4 shadow-xs">
              <h3 className="mb-2 text-sm font-semibold">{t('Onde só uma pessoa revisa')}</h3>
              <ul className="space-y-1 text-xs">
                {sole.map(p => <li key={p.name}><b>{p.name}</b> <span className="text-muted-foreground">{t('revisa 80% ou mais em')}</span> {p.soleReviewerOf.map(r => <Mono key={r} className="mr-1.5 text-[11px]">{r}</Mono>)}</li>)}
              </ul>
              <p className="mt-2 text-[11px] text-muted-foreground">{t('Sugestão: pareie outra pessoa nas reviews desses repositórios por algumas semanas.')}</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
