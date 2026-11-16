// Diff da sessão vs. a branch base, status do PR e criação de PR rascunho (com confirmação).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleDot, ExternalLink, FileCode2, GitPullRequest, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Mono, Pill } from '@/components/common';
import { api } from '@/lib/api';
import { editorLink, plural } from '@/lib/format';
import type { AgentSession, DiffResponse, PrInfo, PrStatus } from '@/lib/types';
import { PROTECTED_BRANCH } from './session-meta';

const enc = encodeURIComponent;

function PrLine({ session, pr }: { session: AgentSession; pr: PrStatus | undefined }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const create = useMutation({
    mutationFn: () => api.post<{ url: string }>(`/api/sessions/${enc(session.id)}/pr`),
    onSuccess: (r) => {
      toast.success('PR rascunho criado', { action: { label: 'Abrir', onClick: () => window.open(r.url, '_blank', 'noopener') } });
      void qc.invalidateQueries({ queryKey: ['pr', session.id] });
    },
    onError: (e: Error) => toast.error('Não foi possível criar o PR', { description: e.message }),
  });

  if (!pr) return <Skeleton className="h-6 w-48" />;
  if ('error' in pr) return <p className="text-xs text-danger">gh: {pr.error}</p>;
  if ('none' in pr) {
    const canCreate = !!session.branch && !PROTECTED_BRANCH.test(session.branch);
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <GitPullRequest className="size-3.5" /> Sem PR
        {canCreate && (
          <>
            <Button size="xs" variant="outline" className="ml-auto" disabled={create.isPending} onClick={() => setConfirm(true)}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <GitPullRequest />} Criar PR rascunho
            </Button>
            <AlertDialog open={confirm} onOpenChange={setConfirm}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Publicar branch e abrir PR rascunho?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Isto faz <Mono>git push</Mono> da branch <Mono>{session.branch}</Mono> e abre um PR em rascunho no GitHub.
                    É uma ação visível para o time.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => create.mutate()}>Fazer push e abrir PR</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>
    );
  }
  const p: PrInfo = pr;
  const review = p.review === 'APPROVED' ? { t: 'aprovado', tone: 'success' as const }
    : p.review === 'CHANGES_REQUESTED' ? { t: 'mudanças pedidas', tone: 'danger' as const }
    : p.review === 'REVIEW_REQUIRED' ? { t: 'review pendente', tone: 'warning' as const } : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <a href={p.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-medium hover:underline">
        <GitPullRequest className="size-3.5" /> PR #{p.number} <ExternalLink className="size-3 opacity-60" />
      </a>
      <Pill>{p.state.toLowerCase()}{p.draft ? ' · rascunho' : ''}</Pill>
      {!!p.checks?.fail && <Pill tone="danger"><XCircle className="size-3" />{p.checks.fail}</Pill>}
      {!!p.checks?.pending && <Pill tone="warning"><CircleDot className="size-3" />{p.checks.pending}</Pill>}
      {!!p.checks?.pass && <Pill tone="success"><CheckCircle2 className="size-3" />{p.checks.pass}</Pill>}
      {review && <Pill tone={review.tone}>{review.t}</Pill>}
    </div>
  );
}

export function ReviewPanel({ session, editor }: { session: AgentSession; editor: string }) {
  const [patchFile, setPatchFile] = useState<string | null | undefined>(undefined); // undefined = fechado, null = diff completo
  const diff = useQuery({
    queryKey: ['diff', session.id],
    queryFn: () => api.get<DiffResponse>(`/api/sessions/${enc(session.id)}/diff`),
    staleTime: 15_000,
  });
  const pr = useQuery({
    queryKey: ['pr', session.id],
    queryFn: () => api.get<PrStatus>(`/api/sessions/${enc(session.id)}/pr`),
    staleTime: 60_000,
  });
  const patch = useQuery({
    queryKey: ['patch', session.id, patchFile],
    queryFn: () => api.get<string>(`/api/sessions/${enc(session.id)}/patch${patchFile ? `?file=${enc(patchFile)}` : ''}`),
    enabled: patchFile !== undefined,
  });

  const d = diff.data;
  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-2.5">
      <PrLine session={session} pr={pr.data ?? (pr.error ? { error: (pr.error as Error).message } : undefined)} />
      {diff.isLoading && <Skeleton className="h-16 w-full" />}
      {diff.error && <p className="text-xs text-danger">{(diff.error as Error).message}</p>}
      {d && 'error' in d && <p className="text-xs text-muted-foreground">{d.error}</p>}
      {d && !('error' in d) && (
        <>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Mono className="text-success">+{d.add}</Mono><Mono className="text-danger">−{d.del}</Mono>
            <span>vs <Mono>{d.base}</Mono>{d.commits ? ` · ${plural(d.commits, 'commit', 'commits')}` : ''}</span>
            {d.files.length > 0 && <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setPatchFile(null)}><FileCode2 /> Diff completo</Button>}
          </div>
          {d.files.length > 0 && (
            <ul className="max-h-48 space-y-px overflow-auto">
              {d.files.map(f => (
                <li key={f.path} className="group flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-accent">
                  <Mono className="w-10 shrink-0 text-right text-success">{f.add == null ? 'bin' : `+${f.add}`}</Mono>
                  <Mono className="w-10 shrink-0 text-danger">{f.del == null ? '' : `−${f.del}`}</Mono>
                  <button type="button" className="min-w-0 flex-1 truncate text-left font-mono text-[12px] hover:underline" title={f.path} onClick={() => setPatchFile(f.path)}>{f.path}</button>
                  {session.cwd && (
                    <a href={editorLink(editor, session.cwd, f.path)} className="opacity-0 transition group-hover:opacity-100" title={`Abrir no ${editor}`}>
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          {d.untracked.length > 0 && (
            <p className="text-xs text-muted-foreground">{plural(d.untracked.length, 'arquivo novo', 'arquivos novos')} sem <Mono>git add</Mono></p>
          )}
        </>
      )}

      <Dialog open={patchFile !== undefined} onOpenChange={(o) => { if (!o) setPatchFile(undefined); }}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{session.project} · {patchFile ?? 'diff completo'}</DialogTitle>
            <DialogDescription>Mudanças da sessão em relação à branch base.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/40">
            {patch.isLoading ? <div className="p-4"><Skeleton className="h-40 w-full" /></div> : <PatchView text={patch.data ?? ''} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PatchView({ text }: { text: string }) {
  return (
    <pre className="p-3 font-mono text-[12px] leading-5">
      {text.split('\n').map((l, i) => {
        const cls = l.startsWith('diff --git') ? 'mt-3 block font-semibold text-foreground first:mt-0'
          : l.startsWith('@@') ? 'block text-info'
          : l.startsWith('+') && !l.startsWith('+++') ? 'block bg-success-soft text-success'
          : l.startsWith('-') && !l.startsWith('---') ? 'block bg-danger-soft text-danger'
          : 'block text-muted-foreground';
        return <span key={i} className={cls}>{l || ' '}</span>;
      })}
    </pre>
  );
}
