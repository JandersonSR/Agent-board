// Execuções de agentes (review/tarefa) e ações sobre PRs.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';

export type Severity = 'blocker' | 'high' | 'medium' | 'low' | 'note';
export interface ReviewResult {
  verdict: 'approve' | 'request_changes' | 'comment'; readyForProd: boolean; confidence: number; summary: string;
  risks: string[]; blockers: string[];
  findings: Array<{ severity: Severity; path?: string; line?: number; title: string; body: string; suggestion?: string }>;
}
export interface Run {
  _id: string; kind: 'review' | 'task'; engine: 'claude'; itemKey: string; title: string;
  target: { prUrl?: string; issueUrl?: string; repo?: string };
  status: 'running' | 'done' | 'failed' | 'timeout' | 'cancelled'; model: string;
  promptMasked?: string; maskedCount: number; startedAt: string; endedAt?: string;
  log: Array<{ at: string; type: string; text: string }>;
  result?: { review?: ReviewResult; text?: string; error?: string };
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number; durationMs: number; turns: number };
  actions: Array<{ type: string; at: string; ok: boolean; detail?: string }>;
}

export const useRuns = () => useQuery({
  queryKey: ['runs'],
  queryFn: () => api.get<{ running: number; items: Run[] }>('/api/runs'),
  refetchInterval: q => (q.state.data?.running ? 3000 : 30_000),
});

export const useRun = (id: string | null) => useQuery({
  queryKey: ['run', id],
  queryFn: () => api.get<Run>(`/api/runs/${id}`),
  enabled: !!id,
  refetchInterval: q => (q.state.data?.status === 'running' ? 2000 : false),
});

export function useReviewPreview() {
  return useMutation({ mutationFn: (b: { url: string; title?: string }) => api.post<{ prompt: string; masked: number; features: string[] }>('/api/review/preview', b) });
}

export function useStartReview(onStarted?: (id: string) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { url: string; title?: string; prompt?: string }) => api.post<{ id: string }>('/api/review/run', b),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['runs'] }); toast.success('Review iniciada em segundo plano'); onStarted?.(r.id); },
    onError: (e: Error) => toast.error('Não foi possível iniciar', { description: e.message }),
  });
}

export function useOpenReviewTerminal() {
  return useMutation({
    mutationFn: (url: string) => api.post<{ dir: string }>('/api/review/terminal', { url }),
    onSuccess: (r) => toast.success('Terminal aberto com o Claude', { description: r.dir }),
    onError: (e: Error) => toast.error('Não foi possível abrir o terminal', { description: e.message }),
  });
}

export function useOpenReviewCursor() {
  return useMutation({
    mutationFn: (url: string) => api.post<{ dir: string; command: string }>('/api/review/cursor', { url }),
    onSuccess: async (r) => {
      let copied = false;
      try { await navigator.clipboard.writeText(r.command); copied = true; } catch { /* sem clipboard */ }
      toast.success('Cursor aberto', { description: copied ? `Comando copiado — cole no chat: ${r.command}` : `Cole no chat: ${r.command}`, duration: 8000 });
    },
    onError: (e: Error) => toast.error('Não foi possível abrir o Cursor', { description: e.message }),
  });
}

export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/runs/${id}/cancel`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['runs'] }); void qc.invalidateQueries({ queryKey: ['run'] }); },
    onError: (e: Error) => toast.error('Não foi possível cancelar', { description: e.message }),
  });
}

export function usePendingReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ url: string; comments: number; unanchored: number }>(`/api/runs/${id}/pending-review`),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['run'] });
      toast.success('Review PENDING criada no GitHub', {
        description: `${r.comments} comentário(s) nas linhas · ${r.unanchored} no corpo. Confira e submeta no GitHub.`,
        action: { label: 'Abrir PR', onClick: () => window.open(r.url, '_blank', 'noopener') }, duration: 10_000,
      });
    },
    onError: (e: Error) => toast.error('Não foi possível criar a review', { description: e.message }),
  });
}
