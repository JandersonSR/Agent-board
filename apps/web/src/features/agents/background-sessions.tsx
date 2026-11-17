// Background sessions from Claude Code's agent view (`claude agents`).
// Here you can see the state, read the logs, copy the attach command and stop a session.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCopy, FileText, Layers, Loader2, Square, TerminalSquare } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Dot, EmptyState, Mono, Pill, type Tone } from '@/components/common';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import { k, t } from '@/lib/i18n';

export interface BgSession {
  id: string; name?: string; cwd: string; kind: string; startedAt: number;
  state?: string; status?: string; waitingFor?: string; pid?: number; sessionId?: string;
}
type Listing = { available: true; sessions: BgSession[] } | { available: false; reason: string };

const STATE: Record<string, { label: string; tone: Tone }> = {
  blocked: { label: k('needs you'), tone: 'danger' },
  working: { label: k('working'), tone: 'info' },
  done: { label: k('done|session'), tone: 'success' },
  failed: { label: k('failed'), tone: 'danger' },
  stopped: { label: k('stopped'), tone: 'neutral' },
};
const WAITING: Record<string, string> = {
  'permission prompt': k('permission request'), 'input needed': k('question for you'), 'sandbox request': k('sandbox request'),
  'worker request': k('worker request'), 'dialog open': k('dialog open'),
};

const PROC: Record<string, string> = { busy: k('busy'), waiting: k('waiting'), idle: k('idle') };

export const useBackgroundSessions = () => useQuery({
  queryKey: ['claude-agents'], queryFn: () => api.get<Listing>('/api/claude-agents'), refetchInterval: 10_000,
});

const project = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;

export function BackgroundSessions() {
  const q = useBackgroundSessions();
  const qc = useQueryClient();
  const [logsOf, setLogsOf] = useState<BgSession | null>(null);
  const [stopping, setStopping] = useState<BgSession | null>(null);
  const logs = useQuery({ queryKey: ['claude-agents-logs', logsOf?.id], queryFn: () => api.get<{ text: string }>(`/api/claude-agents/${logsOf!.id}/logs`), enabled: !!logsOf, refetchInterval: 5_000 });
  const stop = useMutation({
    mutationFn: (id: string) => api.post(`/api/claude-agents/${id}/stop`),
    onSuccess: () => { toast.success(t('Session stopped')); void qc.invalidateQueries({ queryKey: ['claude-agents'] }); },
    onError: (e: Error) => toast.error(t('Could not stop'), { description: e.message }),
  });
  const copy = async (s: BgSession) => { await navigator.clipboard.writeText(`claude attach ${s.id}`); toast.success(t('Command copied: paste it in a terminal')); };

  if (q.isLoading) return <div className="space-y-2">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>;
  const d = q.data;
  if (!d) return <p className="text-sm text-danger">{(q.error as Error | null)?.message}</p>;
  if (!d.available) {
    return (
      <div className="rounded-xl border border-dashed">
        <EmptyState icon={Layers} title={t('Claude Code agent view unavailable')} description={<>{d.reason}. {t('With Claude Code v2.1.139 or newer, sessions started with')} <code className="font-mono">claude --bg</code> {t('or')} <code className="font-mono">/bg</code> {t('show up here.')}</>} />
      </div>
    );
  }
  if (!d.sessions.length) {
    return (
      <div className="rounded-xl border border-dashed">
        <EmptyState icon={Layers} title={t('No background sessions')} description={<>{t('Send a session to the background with')} <code className="font-mono">/bg</code> {t('or start one with')} <code className="font-mono">claude --bg "…"</code>. {t('They show up here and in')} <code className="font-mono">claude agents</code>.</>} />
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <ul className="divide-y">
        {d.sessions.map(s => {
          const st = STATE[s.state ?? ''] ?? { label: s.state ?? '—', tone: 'neutral' as Tone };
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
              <Dot tone={st.tone} pulse={s.state === 'working' || s.state === 'blocked'} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[13px]"><span className="truncate font-medium">{s.name ?? s.id}</span><Mono className="text-[11px] text-muted-foreground">{s.id}</Mono></p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {project(s.cwd)} · {t('started {time} ago', { time: ago(s.startedAt) })}
                  {s.state === 'blocked' && s.waitingFor ? ` · ${t(WAITING[s.waitingFor] ?? s.waitingFor)}` : ''}
                  {s.state === 'working' && s.status ? ` · ${t(PROC[s.status] ?? s.status)}` : ''}
                </p>
              </div>
              <Pill tone={st.tone}>{t(st.label)}</Pill>
              <Button size="xs" variant="outline" onClick={() => setLogsOf(s)}><FileText /> {t('Logs')}</Button>
              <Button size="xs" variant="outline" onClick={() => void copy(s)} aria-label={t('Copy the attach command')}><ClipboardCopy /> attach</Button>
              {(s.state === 'working' || s.state === 'blocked') && (
                <Button size="xs" variant="ghost" className="text-danger" onClick={() => setStopping(s)} disabled={stop.isPending}><Square /> {t('Stop')}</Button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="flex items-center gap-1.5 border-t px-3.5 py-2 text-[11px] text-muted-foreground">
        <TerminalSquare className="size-3.5" /> {t('To reply or approve, attach in a terminal (claude attach) or open')} <code className="font-mono">claude agents</code>.
      </p>

      <Dialog open={!!logsOf} onOpenChange={o => { if (!o) setLogsOf(null); }}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{logsOf?.name ?? logsOf?.id} · {logsOf?.id}</DialogTitle>
            <DialogDescription>{t('Recent session output (claude logs), with personal data masked. Refreshes on its own.')}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted/50 p-3">
            {logs.isLoading ? <Loader2 className="size-4 animate-spin" /> : logs.error ? <p className="text-xs text-danger">{(logs.error as Error).message}</p>
              : <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{logs.data?.text || t('(no output)')}</pre>}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!stopping} onOpenChange={o => { if (!o) setStopping(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Stop the session {name}?', { name: stopping?.name ?? stopping?.id ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('The session stops where it is. The conversation and worktree stay; you can resume later with claude respawn.')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (stopping) stop.mutate(stopping.id); setStopping(null); }}>{t('Stop')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
