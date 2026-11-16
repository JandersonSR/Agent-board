// Execuções de agentes disparadas pelo painel: lista, log ao vivo, resultado e ações.
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Bot, Check, CheckCircle2, CircleDot, Clock, ExternalLink, GitPullRequestDraft, Loader2, Square, X, XCircle,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, Mono, Pill, type Tone } from '@/components/common';
import { useCancelRun, usePendingReview, useRun, useRuns, useSetFeedback, type FindingDecision, type Run, type Severity } from '@/hooks/use-runs';
import { TaskDetail, TaskPhasePill } from './task-detail';
import { ago, dur, fmtCost, fmtTok } from '@/lib/format';
import { k, locale, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// label é chave de tradução (texto em português).
const STATUS: Record<Run['status'], { label: string; tone: Tone; icon: typeof CheckCircle2 }> = {
  running: { label: k('rodando'), tone: 'info', icon: Loader2 },
  done: { label: k('concluída'), tone: 'success', icon: CheckCircle2 },
  failed: { label: k('falhou'), tone: 'danger', icon: XCircle },
  timeout: { label: k('tempo esgotado'), tone: 'warning', icon: Clock },
  cancelled: { label: k('cancelada'), tone: 'neutral', icon: Square },
};
const SEV: Record<Severity, Tone> = { blocker: 'danger', high: 'danger', medium: 'warning', low: 'info', note: 'neutral' };

export function RunStatusPill({ status }: { status: Run['status'] }) {
  const s = STATUS[status];
  return <Pill tone={s.tone}><s.icon className={cn('size-3', status === 'running' && 'animate-spin')} />{t(s.label)}</Pill>;
}

function RunDetail({ id }: { id: string }) {
  const q = useRun(id);
  const cancel = useCancelRun();
  const pending = usePendingReview();
  const feedback = useSetFeedback(id);
  const [confirm, setConfirm] = useState(false);
  const logEnd = useRef<HTMLDivElement>(null);
  const r = q.data;
  useEffect(() => { if (r?.status === 'running') logEnd.current?.scrollIntoView({ block: 'end' }); }, [r?.log.length, r?.status]);

  if (q.isLoading || !r) return <div className="space-y-3 p-4"><Skeleton className="h-8" /><Skeleton className="h-40" /></div>;
  if (r.kind === 'task') return <TaskDetail run={r} />;
  const review = r.result?.review;
  const decisions: FindingDecision[] = review ? review.findings.map((_, i) => r.findingDecisions?.[i] ?? null) : [];
  const decide = (i: number, d: Exclude<FindingDecision, null>) => {
    const next = [...decisions];
    next[i] = next[i] === d ? null : d;
    feedback.mutate(next);
  };
  const kept = decisions.filter(d => d !== 'rejected').length;
  const judged = decisions.filter(Boolean).length;
  const posted = r.actions.find(a => a.type === 'pending_review' && a.ok);
  const elapsed = (r.endedAt ? Date.parse(r.endedAt) : Date.now()) - Date.parse(r.startedAt);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="space-y-2 border-b p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{r.title}</p>
            <p className="text-xs text-muted-foreground">
              {r.kind === 'review' ? 'Review' : t('Tarefa')} · {r.promptVersion ?? r.model}{r.promptEdited ? ` (${t('prompt editado')})` : ''} · {t('iniciada há {time}', { time: ago(Date.parse(r.startedAt)) })} · {dur(elapsed)}
              {r.usage && <> · {fmtTok(r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens)} in / {fmtTok(r.usage.outputTokens)} out · {fmtCost(r.usage.costUsd)}</>}
            </p>
          </div>
          <RunStatusPill status={r.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {r.target.prUrl && <Button size="xs" variant="outline" onClick={() => window.open(r.target.prUrl, '_blank', 'noopener')}><ExternalLink /> {t('Abrir PR')}</Button>}
          {r.status === 'running' && <Button size="xs" variant="outline" onClick={() => cancel.mutate(r._id)} disabled={cancel.isPending}><Square /> {t('Cancelar')}</Button>}
          {review && r.evalCaseId && <Pill tone="info">{t('avaliação: não vira review no GitHub')}</Pill>}
          {review && !r.evalCaseId && (posted
            ? <Pill tone="success"><CheckCircle2 className="size-3" />{t('review PENDING criada há {time}', { time: ago(Date.parse(posted.at)) })}</Pill>
            : <Button size="xs" onClick={() => setConfirm(true)} disabled={pending.isPending}>
                {pending.isPending ? <Loader2 className="animate-spin" /> : <GitPullRequestDraft />} {t('Criar review PENDING no GitHub')}
              </Button>)}
        </div>
      </header>

      <Tabs defaultValue={review ? 'result' : 'log'} key={`${r._id}-${!!review}`} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-4 mt-3 w-fit">
          <TabsTrigger value="result" disabled={!review && !r.result?.error}>{t('Resultado')}</TabsTrigger>
          <TabsTrigger value="log">{t('Log ({n})', { n: r.log.length })}</TabsTrigger>
          <TabsTrigger value="prompt">Prompt</TabsTrigger>
        </TabsList>

        <TabsContent value="result" className="min-h-0 flex-1 overflow-auto p-4">
          {r.result?.error && <p className="mb-3 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger"><AlertTriangle className="mt-0.5 size-3.5" />{r.result.error}</p>}
          {review && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={review.readyForProd ? 'success' : 'danger'}>{t('Pronto para produção: {ready}', { ready: t(review.readyForProd ? 'SIM' : 'NÃO') })}</Pill>
                <Pill tone={review.verdict === 'approve' ? 'success' : review.verdict === 'request_changes' ? 'danger' : 'warning'}>
                  {t(review.verdict === 'approve' ? 'aprovaria' : review.verdict === 'request_changes' ? 'pediria mudanças' : 'comentários')}
                </Pill>
                <Pill>{t('confiança {pct}%', { pct: review.confidence })}</Pill>
              </div>
              <p className="text-sm leading-relaxed">{review.summary}</p>
              {review.blockers.length > 0 && (
                <section><h3 className="mb-1 text-xs font-semibold text-danger">{t('Bloqueadores')}</h3><ul className="list-disc space-y-0.5 pl-5 text-xs">{review.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></section>
              )}
              {review.risks.length > 0 && (
                <section><h3 className="mb-1 text-xs font-semibold">{t('Riscos')}</h3><ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{review.risks.map((b, i) => <li key={i}>{b}</li>)}</ul></section>
              )}
              <section className="space-y-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="text-xs font-semibold">{t('Achados ({n})', { n: review.findings.length })}</h3>
                  {review.findings.length > 0 && <span className="text-[11px] text-muted-foreground">{t('{judged} de {total} julgados · {kept} vão para a review', { judged, total: review.findings.length, kept })}</span>}
                </div>
                {review.findings.length > 0 && !posted && <p className="text-[11px] text-muted-foreground">{t('Marque cada achado. Os descartados não vão para o GitHub, e o julgamento mede a precisão da review por IA.')}</p>}
                {review.findings.length === 0 && <p className="text-xs text-muted-foreground">{t('Nenhum achado.')}</p>}
                {review.findings.map((f, i) => (
                  <article key={i} className={cn('rounded-lg border p-3', decisions[i] === 'rejected' && 'opacity-55', decisions[i] === 'accepted' && 'border-success/40')}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={SEV[f.severity]}>{f.severity}</Pill>
                      <span className="text-[13px] font-medium">{f.title}</span>
                      {f.path && <Mono className="ml-auto text-[11px] text-muted-foreground">{f.path}{f.line ? `:${f.line}` : ''}</Mono>}
                      <div className={cn('flex gap-1', !f.path && 'ml-auto')}>
                        <Button size="xs" variant={decisions[i] === 'accepted' ? 'secondary' : 'ghost'} aria-pressed={decisions[i] === 'accepted'}
                          disabled={feedback.isPending || !!posted} onClick={() => decide(i, 'accepted')}><Check /> {t('Manter')}</Button>
                        <Button size="xs" variant={decisions[i] === 'rejected' ? 'secondary' : 'ghost'} aria-pressed={decisions[i] === 'rejected'}
                          disabled={feedback.isPending || !!posted} onClick={() => decide(i, 'rejected')}><X /> {t('Descartar')}</Button>
                      </div>
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
                <span className="shrink-0 text-muted-foreground tabular-nums">{new Date(l.at).toLocaleTimeString(locale())}</span>
                <span className="w-16 shrink-0 text-muted-foreground">{l.type}</span>
                <span className="min-w-0 whitespace-pre-wrap break-words">{l.text}</span>
              </li>
            ))}
            {r.status === 'running' && <li className="flex items-center gap-2 text-muted-foreground"><CircleDot className="size-3 animate-pulse" /> {t('trabalhando…')}</li>}
          </ol>
          <div ref={logEnd} />
        </TabsContent>

        <TabsContent value="prompt" className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          <p className="mb-2 text-[11px] text-muted-foreground">{r.maskedCount ? t('{n} dado(s) mascarado(s) antes do envio.', { n: r.maskedCount }) : t('Nenhum dado pessoal detectado.')}</p>
          <pre className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">{r.promptMasked}</pre>
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Criar review PENDING no GitHub?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('Os {n} achados mantidos viram uma review pendente no seu nome: comentários nas linhas do diff e o resto no corpo.', { n: kept })}
              {' '}{t('Ela só fica visível para o autor depois que você a submeter no GitHub. Nada é aprovado.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancelar')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pending.mutate(r._id)}>{t('Criar review pendente')}</AlertDialogAction>
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
          <Bot className="size-4 text-muted-foreground" /> {t('Execuções')}
          {q.data && <Pill className="ml-auto">{t('{n} rodando', { n: q.data.running })}</Pill>}
        </header>
        {q.isLoading ? <div className="space-y-2 p-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
          : items.length === 0 ? <EmptyState icon={Bot} title={t('Nenhuma execução ainda')} description={t('Use ✨ num PR em Reviews pendentes para uma review, ou a varinha numa issue de Minha fila para resolver a tarefa com um agente.')} />
          : (
            <ul className="min-h-0 flex-1 divide-y overflow-auto">
              {items.map(r => (
                <li key={r._id}>
                  <button type="button" onClick={() => onSelect(r._id)} aria-current={current === r._id}
                    className={cn('w-full px-3.5 py-2.5 text-left hover:bg-muted/60', current === r._id && 'bg-muted')}>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px]">{r.title}</span>
                      {r.kind === 'task' ? <TaskPhasePill phase={r.task?.phase} /> : <RunStatusPill status={r.status} />}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {r.kind === 'review' ? 'review' : t('tarefa')} · {ago(Date.parse(r.startedAt))}
                      {r.usage && ` · ${fmtCost(r.usage.costUsd)}`}
                      {r.result?.review && ` · ${t('{n} achados', { n: r.result.review.findings.length })}`}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </section>
      <section className="min-h-[24rem] overflow-hidden rounded-xl border bg-card shadow-xs">
        {current ? <RunDetail id={current} /> : <EmptyState icon={Bot} title={t('Selecione uma execução')} />}
      </section>
    </div>
  );
}
