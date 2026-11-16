// Tarefa de ponta a ponta: plano → aprovação → implementação → verificação → PR em rascunho.
// Cada passo que sai da máquina (PR) pede confirmação; descartar remove a worktree e a branch local.
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, CircleDot, ExternalLink, FileCode2, GitBranch, GitPullRequestDraft, HelpCircle, Loader2, Play, ShieldCheck, Square, Trash2, XCircle,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Mono, Pill, type Tone } from '@/components/common';
import {
  useApproveTask, useCancelRun, useDiscardTask, useTaskDiff, useTaskPatch, useTaskPr, type Run, type TaskPhase,
} from '@/hooks/use-runs';
import { ago, dur, fmtCost, fmtTok } from '@/lib/format';
import { k, locale, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PatchView } from '../agents/review-panel';

// label é chave de tradução (texto em português).
const PHASE: Record<TaskPhase, { label: string; tone: Tone; busy?: boolean }> = {
  planning: { label: k('planejando'), tone: 'info', busy: true },
  awaiting_approval: { label: k('plano para aprovar'), tone: 'warning' },
  implementing: { label: k('implementando'), tone: 'info', busy: true },
  verifying: { label: k('verificando'), tone: 'info', busy: true },
  ready: { label: k('pronta para PR'), tone: 'success' },
  pr_opened: { label: k('PR aberto'), tone: 'success' },
  discarded: { label: k('descartada'), tone: 'neutral' },
  failed: { label: k('falhou'), tone: 'danger' },
};

export function TaskPhasePill({ phase }: { phase: TaskPhase | undefined }) {
  const p = PHASE[phase ?? 'planning'];
  return <Pill tone={p.tone}>{p.busy ? <Loader2 className="size-3 animate-spin" /> : null}{t(p.label)}</Pill>;
}

function List({ title, items, tone }: { title: string; items: string[]; tone?: 'danger' | 'warning' }) {
  if (!items.length) return null;
  return (
    <section>
      <h4 className={cn('mb-1 text-xs font-semibold', tone === 'danger' && 'text-danger', tone === 'warning' && 'text-warning')}>{t(title)}</h4>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </section>
  );
}

function TaskDiff({ run }: { run: Run }) {
  const diff = useTaskDiff(run._id, true);
  const [file, setFile] = useState<string | null | undefined>(undefined);
  const patch = useTaskPatch(run._id, file);
  const d = diff.data;
  if (diff.isLoading) return <Skeleton className="h-16" />;
  if (diff.error) return <p className="text-xs text-danger">{(diff.error as Error).message}</p>;
  if (!d || 'error' in d) return null;
  return (
    <section className="space-y-1.5 rounded-lg border bg-muted/30 p-2.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Mono className="text-success">+{d.add}</Mono><Mono className="text-danger">−{d.del}</Mono>
        <span>vs <Mono>{d.base}</Mono> · {t('{n} commit(s)', { n: d.commits })}</span>
        {d.files.length > 0 && <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setFile(null)}><FileCode2 /> {t('Diff completo')}</Button>}
      </div>
      <ul className="max-h-48 space-y-px overflow-auto">
        {d.files.map(f => (
          <li key={f.path} className="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-accent">
            <Mono className="w-10 shrink-0 text-right text-success">{f.add == null ? 'bin' : `+${f.add}`}</Mono>
            <Mono className="w-10 shrink-0 text-danger">{f.del == null ? '' : `−${f.del}`}</Mono>
            <button type="button" className="min-w-0 flex-1 truncate text-left font-mono text-[12px] hover:underline" onClick={() => setFile(f.path)}>{f.path}</button>
          </li>
        ))}
      </ul>
      <Dialog open={file !== undefined} onOpenChange={o => { if (!o) setFile(undefined); }}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{run.task?.branch} · {file ?? t('diff completo')}</DialogTitle>
            <DialogDescription>{t('Mudanças da tarefa em relação à branch base.')}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/40">
            {patch.isLoading ? <div className="p-4"><Skeleton className="h-40 w-full" /></div> : <PatchView text={patch.data ?? ''} />}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function TaskDetail({ run: r }: { run: Run }) {
  const task = r.task!;
  const approve = useApproveTask();
  const discard = useDiscardTask();
  const openPr = useTaskPr();
  const cancel = useCancelRun();
  const [notes, setNotes] = useState('');
  const [confirm, setConfirm] = useState<'pr' | 'discard' | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const busy = r.status === 'running';
  useEffect(() => { if (busy) logEnd.current?.scrollIntoView({ block: 'end' }); }, [r.log.length, busy]);

  const plan = task.plan;
  const impl = task.implementation;
  const canDiscard = !['pr_opened', 'discarded'].includes(task.phase);
  const showDiff = ['ready', 'pr_opened', 'failed', 'implementing', 'verifying'].includes(task.phase) && !!task.approvedAt;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="space-y-2 border-b p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{r.title}</p>
            <p className="text-xs text-muted-foreground">
              {t('Tarefa')} · {r.promptVersion ?? r.model} · {t('iniciada há {time}', { time: ago(Date.parse(r.startedAt)) })}
              {r.usage && <> · {fmtTok(r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens)} in / {fmtTok(r.usage.outputTokens)} out · {fmtCost(r.usage.costUsd)}</>}
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground"><GitBranch className="size-3" /><Mono className="text-[11px]">{task.branch}</Mono> ← <Mono className="text-[11px]">{task.base}</Mono></p>
          </div>
          <TaskPhasePill phase={task.phase} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="xs" variant="outline" onClick={() => window.open(task.issueUrl, '_blank', 'noopener')}><ExternalLink /> {t('Abrir issue')}</Button>
          {task.prUrl && <Button size="xs" onClick={() => window.open(task.prUrl, '_blank', 'noopener')}><ExternalLink /> {t('Abrir PR')}</Button>}
          {busy && <Button size="xs" variant="outline" onClick={() => cancel.mutate(r._id)} disabled={cancel.isPending}><Square /> {t('Parar agente')}</Button>}
          {canDiscard && <Button size="xs" variant="ghost" className="text-danger" onClick={() => setConfirm('discard')} disabled={discard.isPending}><Trash2 /> {t('Descartar')}</Button>}
        </div>
      </header>

      <Tabs defaultValue="stage" key={`${r._id}-${task.phase}`} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-4 mt-3 w-fit">
          <TabsTrigger value="stage">{t('Etapa')}</TabsTrigger>
          <TabsTrigger value="log">{t('Log ({n})', { n: r.log.length })}</TabsTrigger>
          <TabsTrigger value="prompt">Prompt</TabsTrigger>
        </TabsList>

        <TabsContent value="stage" className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {(task.error || r.result?.error) && (
            <p className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger"><AlertTriangle className="mt-0.5 size-3.5" />{task.error ?? r.result?.error}</p>
          )}
          {task.phase === 'planning' && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t('O agente está lendo o código e montando o plano (só leitura).')}</p>}

          {plan && (
            <section className="space-y-3 rounded-lg border p-3">
              <h3 className="text-xs font-semibold">{t('Plano')}{task.approvedAt && <span className="ml-2 font-normal text-muted-foreground">{t('aprovado em {date}', { date: new Date(task.approvedAt).toLocaleString(locale()) })}</span>}</h3>
              <p className="text-sm leading-relaxed">{plan.summary}</p>
              <ol className="list-decimal space-y-0.5 pl-5 text-xs">{plan.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              {plan.files.length > 0 && <p className="flex flex-wrap gap-1 text-[11px]">{plan.files.map(f => <Mono key={f} className="rounded bg-muted px-1 text-[11px]">{f}</Mono>)}</p>}
              <List title={k('Testes previstos')} items={plan.tests} />
              <List title={k('Riscos')} items={plan.risks} tone="warning" />
              {plan.questions.length > 0 && (
                <section className="rounded-md bg-warning-soft p-2">
                  <h4 className="mb-1 flex items-center gap-1 text-xs font-semibold text-warning"><HelpCircle className="size-3.5" /> {t('Dúvidas do agente: responda nas observações')}</h4>
                  <ul className="list-disc space-y-0.5 pl-5 text-xs">{plan.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
                </section>
              )}
              {task.notes && <p className="rounded-md bg-muted px-2 py-1.5 text-xs"><b>{t('Suas observações:')}</b> {task.notes}</p>}
            </section>
          )}

          {task.phase === 'awaiting_approval' && (
            <section className="space-y-2">
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} maxLength={4000}
                placeholder={t('Observações para a implementação (respostas às dúvidas, ajustes no plano)…')} aria-label={t('Observações')} />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate({ id: r._id, body: notes.trim() ? { notes } : {} })}>
                  {approve.isPending ? <Loader2 className="animate-spin" /> : <Play />} {t('Aprovar plano e implementar')}
                </Button>
                <span className="text-[11px] text-muted-foreground">{t('O agente trabalha só na worktree da tarefa e não faz push.')}</span>
              </div>
            </section>
          )}

          {(task.phase === 'implementing' || task.phase === 'verifying') && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />
              {t(task.phase === 'implementing' ? 'O agente está implementando e rodando os testes na worktree.' : 'Rodando a verificação independente do painel.')}</p>
          )}

          {impl && (
            <section className="space-y-3 rounded-lg border p-3">
              <h3 className="text-xs font-semibold">{t('Implementação')}</h3>
              <p className="text-sm leading-relaxed">{impl.summary}</p>
              <List title={k('Mudanças')} items={impl.changes} />
              <p className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">{t('Testes do agente:')}</span>
                {impl.testsPassed === null ? <Pill>{t('não informado')}</Pill> : impl.testsPassed ? <Pill tone="success"><CheckCircle2 className="size-3" />{t('passaram')}</Pill> : <Pill tone="danger"><XCircle className="size-3" />{t('falharam')}</Pill>}
                {impl.testsRun.map(c => <Mono key={c} className="text-[11px]">{c}</Mono>)}
              </p>
              <List title={k('Pontos de atenção')} items={impl.followUps} tone="warning" />
            </section>
          )}

          {task.verify && (
            <section className={cn('space-y-1.5 rounded-lg border p-3', task.verify.ok ? 'border-success/40' : 'border-danger/40')}>
              <h3 className="flex items-center gap-1.5 text-xs font-semibold">
                <ShieldCheck className={cn('size-3.5', task.verify.ok ? 'text-success' : 'text-danger')} />
                {t('Verificação independente')} <Mono className="text-[11px]">{task.verify.command}</Mono>
                <Pill tone={task.verify.ok ? 'success' : 'danger'}>{t(task.verify.ok ? 'passou' : 'falhou')}</Pill>
                <span className="font-normal text-muted-foreground">{dur(task.verify.durationMs)}</span>
              </h3>
              {task.verify.output && <pre className="max-h-48 overflow-auto rounded bg-muted p-2 font-mono text-[11px]">{task.verify.output}</pre>}
            </section>
          )}
          {task.phase === 'ready' && !task.verify && <p className="text-[11px] text-muted-foreground">{t('Sem verificação independente para este repositório (TASK_VERIFY no .env).')}</p>}

          {showDiff && <TaskDiff run={r} />}

          {task.phase === 'ready' && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setConfirm('pr')} disabled={openPr.isPending}>
                {openPr.isPending ? <Loader2 className="animate-spin" /> : <GitPullRequestDraft />} {t('Criar PR rascunho')}
              </Button>
              {task.verify && !task.verify.ok && <span className="text-[11px] text-danger">{t('A verificação falhou: revise antes de abrir o PR.')}</span>}
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
            {busy && <li className="flex items-center gap-2 text-muted-foreground"><CircleDot className="size-3 animate-pulse" /> {t('trabalhando…')}</li>}
          </ol>
          <div ref={logEnd} />
        </TabsContent>

        <TabsContent value="prompt" className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          <p className="mb-2 text-[11px] text-muted-foreground">{r.maskedCount ? t('{n} dado(s) mascarado(s) antes do envio.', { n: r.maskedCount }) : t('Nenhum dado pessoal detectado.')}</p>
          <pre className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">{r.promptMasked}</pre>
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirm !== null} onOpenChange={o => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(confirm === 'pr' ? 'Publicar a branch e abrir o PR em rascunho?' : 'Descartar a tarefa?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'pr'
                ? t('Isto faz push da branch {branch} e abre um PR em rascunho que fecha a issue. É uma ação visível para o time.', { branch: task.branch })
                : t('O agente para, e a worktree e a branch local da tarefa são apagadas. O histórico fica em Execuções.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancelar')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (confirm === 'pr') openPr.mutate({ id: r._id });
              else discard.mutate({ id: r._id });
              setConfirm(null);
            }}>{t(confirm === 'pr' ? 'Fazer push e abrir PR' : 'Descartar')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
