// Conjunto fixo de avaliação: PRs com problemas conhecidos para medir o que a review por IA deixa passar.
import { useEffect, useState } from 'react';
import { FlaskConical, Loader2, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { EmptyState, Mono, Pill } from '@/components/common';
import { useDeleteEvalCase, useEvals, useRunEvals, useSaveEvalCase, type EvalCase, type ExpectedFinding } from '@/hooks/use-staff';
import { fmtCost } from '@/lib/format';
import { t } from '@/lib/i18n';
import { pct } from './shared';

const newId = () => Math.random().toString(36).slice(2, 8);
type Row = { id: string; path: string; line: string; keywords: string; note: string };
const toRow = (e: ExpectedFinding): Row => ({ id: e.id, path: e.path ?? '', line: e.line ? String(e.line) : '', keywords: e.keywords.join(', '), note: e.note ?? '' });
const fromRow = (r: Row): ExpectedFinding => ({
  id: r.id, keywords: r.keywords.split(',').map(x => x.trim()).filter(Boolean),
  ...(r.path.trim() ? { path: r.path.trim() } : {}), ...(Number(r.line) > 0 ? { line: Number(r.line) } : {}), ...(r.note.trim() ? { note: r.note.trim() } : {}),
});

function CaseDialog({ value, open, onOpenChange }: { value: EvalCase | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const save = useSaveEvalCase();
  const [name, setName] = useState('');
  const [prUrl, setPrUrl] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (!open) return;
    setName(value?.name ?? ''); setPrUrl(value?.prUrl ?? '');
    setRows(value?.expected.map(toRow) ?? [{ id: newId(), path: '', line: '', keywords: '', note: '' }]);
  }, [open, value]);
  const set = (i: number, p: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const valid = name.trim() && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+\/?$/.test(prUrl.trim()) && rows.length > 0 && rows.every(r => r.path.trim() || r.keywords.trim());
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t(value ? 'Editar caso' : 'Novo caso de avaliação')}</DialogTitle>
          <DialogDescription>{t('Use um PR (pode ser antigo) com problemas que você já conhece. Para cada problema, diga o arquivo e palavras que uma boa review usaria.')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">{t('Nome')}</Label><Input value={name} onChange={e => setName(e.target.value)} maxLength={160} placeholder={t('ex.: arredondamento da última parcela')} /></div>
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">{t('URL do PR')}</Label><Input value={prUrl} onChange={e => setPrUrl(e.target.value)} placeholder="https://github.com/org/repo/pull/123" className="font-mono text-xs" /></div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('Problemas esperados')}</Label>
            {rows.map((r, i) => (
              <div key={r.id} className="flex items-center gap-1.5">
                <Input value={r.path} onChange={e => set(i, { path: e.target.value })} placeholder={t('arquivo')} className="h-8 flex-[2] font-mono text-[11px]" />
                <Input value={r.line} onChange={e => set(i, { line: e.target.value.replace(/\D/g, '') })} placeholder={t('linha')} className="h-8 w-16 text-xs" />
                <Input value={r.keywords} onChange={e => set(i, { keywords: e.target.value })} placeholder={t('palavras-chave, separadas por vírgula')} className="h-8 flex-[2] text-xs" />
                <Input value={r.note} onChange={e => set(i, { note: e.target.value })} placeholder={t('nota')} className="h-8 flex-1 text-xs" />
                <Button size="icon-xs" variant="ghost" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} aria-label={t('Remover')}><X /></Button>
              </div>
            ))}
            <Button size="xs" variant="outline" onClick={() => setRows(rs => [...rs, { id: newId(), path: '', line: '', keywords: '', note: '' }])}><Plus /> {t('Problema')}</Button>
            <p className="text-[11px] text-muted-foreground">{t('Conta como encontrado se um achado for no mesmo arquivo e tiver uma das palavras, ou ficar a até 10 linhas da linha informada.')}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Cancelar')}</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate(
            { ...(value ? { id: value._id } : {}), body: { name: name.trim(), prUrl: prUrl.trim(), expected: rows.map(fromRow) } },
            { onSuccess: () => onOpenChange(false) },
          )}>{save.isPending && <Loader2 className="animate-spin" />} {t('Salvar')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EvalsSection() {
  const q = useEvals();
  const run = useRunEvals();
  const del = useDeleteEvalCase();
  const [editing, setEditing] = useState<EvalCase | null | undefined>(undefined);
  const d = q.data;
  if (q.error) return null; // sem MongoDB: a seção some (a aba já avisa)
  const st = d?.state;
  const names = new Map(d?.cases.map(c => [c._id, c.name]) ?? []);

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <FlaskConical className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{t('Conjunto fixo: o que a IA deixa passar')}</h3>
        <span className="text-[11px] text-muted-foreground">{t('versão atual')} <Mono className="text-[11px]">{d?.currentVersion}</Mono></span>
        <div className="ml-auto flex gap-2">
          <Button size="xs" variant="outline" onClick={() => setEditing(null)}><Plus /> {t('Caso')}</Button>
          <Button size="xs" disabled={!d?.cases.length || st?.running || run.isPending} onClick={() => run.mutate(undefined)}>
            {st?.running ? <Loader2 className="animate-spin" /> : <Play />} {t('Rodar todos')}
          </Button>
        </div>
      </header>

      {st?.running && (
        <div className="space-y-1 border-b px-4 py-2 text-xs">
          <p>{t('Rodando {done} de {total}: {name}', { done: st.done + 1, total: st.total, name: st.current ?? '' })}</p>
          <Progress value={(st.done / Math.max(1, st.total)) * 100} />
        </div>
      )}
      {st?.error && !st.running && <p className="border-b px-4 py-2 text-xs text-danger">{t('A última rodada parou: {e}', { e: st.error })}</p>}

      {d && !d.cases.length && (
        <EmptyState icon={FlaskConical} title={t('Nenhum caso ainda')}
          description={t('Junte de 5 a 10 PRs com bugs que vocês já conhecem. Rode a cada mudança na skill de review e compare o recall entre versões.')} />
      )}

      {d && d.versions.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-muted-foreground"><tr className="border-b text-left">
            <th className="px-4 py-2 font-medium">{t('Versão do prompt')}</th><th className="px-3 text-right font-medium">{t('Casos')}</th>
            <th className="px-3 text-right font-medium">{t('Encontrados')}</th><th className="px-3 text-right font-medium">Recall</th>
            <th className="px-3 text-right font-medium">{t('Achados extras por caso')}</th><th className="px-4 text-right font-medium">{t('Custo')}</th>
          </tr></thead>
          <tbody>
            {d.versions.map(v => (
              <tr key={v.version} className="border-b last:border-0" title={v.perCase.filter(p => p.missed.length).map(p => `${names.get(p.caseId) ?? p.caseId}: ${p.found}/${p.expected}`).join('\n')}>
                <td className="px-4 py-2"><Mono className="text-[11px]">{v.version}</Mono>{v.version === d.currentVersion && <Pill tone="info" className="ml-1.5">{t('atual')}</Pill>}</td>
                <td className="px-3 text-right tabular-nums">{v.cases}/{d.cases.length}</td>
                <td className="px-3 text-right tabular-nums">{v.found}/{v.expected}</td>
                <td className="px-3 text-right"><Pill tone={v.recall === null ? 'neutral' : v.recall >= 0.8 ? 'success' : v.recall >= 0.5 ? 'warning' : 'danger'}>{pct(v.recall)}</Pill></td>
                <td className="px-3 text-right tabular-nums">{v.extraPerCase === null ? '—' : v.extraPerCase.toFixed(1)}</td>
                <td className="px-4 text-right tabular-nums">{fmtCost(v.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {d && d.cases.length > 0 && (
        <ul className="divide-y border-t text-xs">
          {d.cases.map(c => {
            const last = d.versions.find(v => v.version === d.currentVersion)?.perCase.find(p => p.caseId === c._id);
            return (
              <li key={c._id} className="flex items-center gap-2 px-4 py-1.5">
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <Mono className="hidden text-[11px] text-muted-foreground sm:inline">{c.prUrl.replace('https://github.com/', '')}</Mono>
                <span className="text-muted-foreground">{t('{n} esperado(s)', { n: c.expected.length })}</span>
                {last && <Pill tone={last.found === last.expected ? 'success' : 'warning'}>{last.found}/{last.expected}</Pill>}
                <Button size="icon-xs" variant="ghost" onClick={() => run.mutate([c._id])} disabled={st?.running} aria-label={t('Rodar este caso')}><Play /></Button>
                <Button size="icon-xs" variant="ghost" onClick={() => setEditing(c)} aria-label={t('Editar')}><Pencil /></Button>
                <Button size="icon-xs" variant="ghost" className="text-danger" onClick={() => del.mutate(c._id)} aria-label={t('Apagar')}><Trash2 /></Button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        {t('Os casos ficam no MongoDB do painel, fora do repositório. Cada rodada usa uma execução de review e conta nos limites de custo.')}
      </p>
      <CaseDialog value={editing ?? null} open={editing !== undefined} onOpenChange={o => { if (!o) setEditing(undefined); }} />
    </section>
  );
}
