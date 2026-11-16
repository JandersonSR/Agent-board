// Execuções de agentes disparadas pelo painel: lista, log ao vivo, resultado e ações.
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Bot, CheckCircle2, CircleDot, Clock, ExternalLink, GitPullRequestDraft, Loader2, Square, XCircle,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, Mono, Pill, type Tone } from '@/components/common';
import { useCancelRun, usePendingReview, useRun, useRuns, type Run, type Severity } from '@/hooks/use-runs';
import { ago, dur, fmtCost, fmtTok } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS: Record<Run['status'], { label: string; tone: Tone; icon: typeof CheckCircle2 }> = {
  running: { label: 'rodando', tone: 'info', icon: Loader2 },
  done: { label: 'concluída', tone: 'success', icon: CheckCircle2 },
  failed: { label: 'falhou', tone: 'danger', icon: XCircle },
  timeout: { label: 'tempo esgotado', tone: 'warning', icon: Clock },
  cancelled: { label: 'cancelada', tone: 'neutral', icon: Square },
};
const SEV: Record<Severity, Tone> = { blocker: 'danger', high: 'danger', medium: 'warning', low: 'info', note: 'neutral' };

export function RunStatusPill({ status }: { status: Run['status'] }) {
  const s = STATUS[status];
  return <Pill tone={s.tone}><s.icon className={cn('size-3', status === 'running' && 'animate-spin')} />{s.label}</Pill>;
}

function RunDetail({ id }: { id: string }) {
  const q = useRun(id);
  const cancel = useCancelRun();
  const pending = usePendingReview();
  const [confirm, setConfirm] = useState(false);
  const logEnd = useRef<HTMLDivElement>(null);
  const r = q.data;
  useEffect(() => { if (r?.status === 'running') logEnd.current?.scrollIntoView({ block: 'end' }); }, [r?.log.length, r?.status]);

  if (q.isLoading || !r) return <div className="space-y-3 p-4"><Skeleton className="h-8" /><Skeleton className="h-40" /></div>;
  const review = r.result?.review;
  const posted = r.actions.find(a => a.type === 'pending_review' && a.ok);
  const elapsed = (r.endedAt ? Date.parse(r.endedAt) : Date.now()) - Date.parse(r.startedAt);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="space-y-2 border-b p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{r.title}</p>
            <p className="text-xs text-muted-foreground">
              {r.kind === 'review' ? 'Review' : 'Tarefa'} · {r.model} · iniciada há {ago(Date.parse(r.startedAt))} · {dur(elapsed)}
              {r.usage && <> · {fmtTok(r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens)} in / {fmtTok(r.usage.outputTokens)} out · {fmtCost(r.usage.costUsd)}</>}
            </p>
          </div>
          <RunStatusPill status={r.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {r.target.prUrl && <Button size="xs" variant="outline" onClick={() => window.open(r.target.prUrl, '_blank', 'noopener')}><ExternalLink /> Abrir PR</Button>}
          {r.status === 'running' && <Button size="xs" variant="outline" onClick={() => cancel.mutate(r._id)} disabled={cancel.isPending}><Square /> Cancelar</Button>}
          {review && (posted
            ? <Pill tone="success"><CheckCircle2 className="size-3" />review PENDING criada {ago(Date.parse(posted.at))} atrás</Pill>
            : <Button size="xs" onClick={() => setConfirm(true)} disabled={pending.isPending}>
                {pending.isPending ? <Loader2 className="animate-spin" /> : <GitPullRequestDraft />} Criar review PENDING no GitHub
              </Button>)}
        </div>
      </header>

      <Tabs defaultValue={review ? 'result' : 'log'} key={`${r._id}-${!!review}`} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-4 mt-3 w-fit">
          <TabsTrigger value="result" disabled={!review && !r.result?.error}>Resultado</TabsTrigger>
          <TabsTrigger value="log">Log ({r.log.length})</TabsTrigger>
          <TabsTrigger value="prompt">Prompt</TabsTrigger>
        </TabsList>

        <TabsContent value="result" className="min-h-0 flex-1 overflow-auto p-4">
          {r.result?.error && <p className="mb-3 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger"><AlertTriangle className="mt-0.5 size-3.5" />{r.result.error}</p>}
          {review && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={review.readyForProd ? 'success' : 'danger'}>Pronto para produção: {review.readyForProd ? 'SIM' : 'NÃO'}</Pill>
                <Pill tone={review.verdict === 'approve' ? 'success' : review.verdict === 'request_changes' ? 'danger' : 'warning'}>
                  {review.verdict === 'approve' ? 'aprovaria' : review.verdict === 'request_changes' ? 'pediria mudanças' : 'comentários'}
                </Pill>
                <Pill>confiança {review.confidence}%</Pill>
              </div>
              <p className="text-sm leading-relaxed">{review.summary}</p>
              {review.blockers.length > 0 && (
                <section><h3 className="mb-1 text-xs font-semibold text-danger">Bloqueadores</h3><ul className="list-disc space-y-0.5 pl-5 text-xs">{review.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></section>
              )}
              {review.risks.length > 0 && (
                <section><h3 className="mb-1 text-xs font-semibold">Riscos</h3><ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{review.risks.map((b, i) => <li key={i}>{b}</li>)}</ul></section>
              )}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold">Achados ({review.findings.length})</h3>
                {review.findings.length === 0 && <p className="text-xs text-muted-foreground">Nenhum achado.</p>}
                {review.findings.map((f, i) => (
                  <article key={i} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={SEV[f.severity]}>{f.severity}</Pill>
                      <span className="text-[13px] font-medium">{f.title}</span>
                      {f.path && <Mono className="ml-auto text-[11px] text-muted-foreground">{f.path}{f.line ? `:${f.line}` : ''}</Mono>}
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{f.body}</p>
                    {f.suggestion && <pre className="mt-2 overflow-auto rounded bg-muted p-2 font-mono text-[11px]">{f.suggestion}</pre>}
                  </article>
                ))}
              </section>
            </div>
          )}
        </TabsContent>

        <TabsContent value="log" className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          <ol className="space-y-1 font-mono text-[11px]">
            {r.log.map((l, i) => (
              <li key={i} className={cn('flex gap-2', l.type === 'denied' && 'text-warning', l.type === 'stderr' && 'text-danger')}>
                <span className="shrink-0 text-muted-foreground tabular-nums">{new Date(l.at).toLocaleTimeString('pt-BR')}</span>
                <span className="w-16 shrink-0 text-muted-foreground">{l.type}</span>
                <span className="min-w-0 whitespace-pre-wrap break-words">{l.text}</span>
              </li>
            ))}
            {r.status === 'running' && <li className="flex items-center gap-2 text-muted-foreground"><CircleDot className="size-3 animate-pulse" /> trabalhando…</li>}
          </ol>
          <div ref={logEnd} />
        </TabsContent>

        <TabsContent value="prompt" className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          <p className="mb-2 text-[11px] text-muted-foreground">{r.maskedCount ? `${r.maskedCount} dado(s) mascarado(s) antes do envio.` : 'Nenhum dado pessoal detectado.'}</p>
          <pre className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">{r.promptMasked}</pre>
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Criar review PENDING no GitHub?</AlertDialogTitle>
            <AlertDialogDescription>
              Os {review?.findings.length ?? 0} achados viram uma review <b>pendente</b> no seu nome: comentários nas linhas do diff e o resto no corpo.
              Ela só fica visível para o autor depois que você a submeter no GitHub. Nada é aprovado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => pending.mutate(r._id)}>Criar review pendente</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function RunsView({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const q = useRuns();
  const items = q.data?.items ?? [];
  const current = selected ?? items[0]?._id ?? null;
  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[22rem_1fr]">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
        <header className="flex items-center gap-2 border-b px-3.5 py-2.5 text-[13px] font-semibold">
          <Bot className="size-4 text-muted-foreground" /> Execuções
          {q.data && <Pill className="ml-auto">{q.data.running} rodando</Pill>}
        </header>
        {q.isLoading ? <div className="space-y-2 p-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
          : items.length === 0 ? <EmptyState icon={Bot} title="Nenhuma execução ainda" description="Use o botão ✨ num PR em Reviews pendentes para pedir uma review ao Claude." />
          : (
            <ul className="min-h-0 flex-1 divide-y overflow-auto">
              {items.map(r => (
                <li key={r._id}>
                  <button type="button" onClick={() => onSelect(r._id)} aria-current={current === r._id}
                    className={cn('w-full px-3.5 py-2.5 text-left hover:bg-muted/60', current === r._id && 'bg-muted')}>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px]">{r.title}</span>
                      <RunStatusPill status={r.status} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {r.kind === 'review' ? 'review' : 'tarefa'} · {ago(Date.parse(r.startedAt))}
                      {r.usage && ` · ${fmtCost(r.usage.costUsd)}`}
                      {r.result?.review && ` · ${r.result.review.findings.length} achados`}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </section>
      <section className="min-h-[24rem] overflow-hidden rounded-xl border bg-card shadow-xs">
        {current ? <RunDetail id={current} /> : <EmptyState icon={Bot} title="Selecione uma execução" />}
      </section>
    </div>
  );
}
