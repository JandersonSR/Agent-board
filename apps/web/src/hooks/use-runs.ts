// Execuções de agentes (review/tarefa) e ações sobre PRs.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { k, t } from '@/lib/i18n';

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
  promptVersion?: string; promptEdited?: boolean; evalCaseId?: string;
  findingDecisions?: FindingDecision[];
  task?: TaskState;
}

export type FindingDecision = 'accepted' | 'rejected' | null;

export type TaskPhase = 'planning' | 'awaiting_approval' | 'implementing' | 'verifying' | 'ready' | 'pr_opened' | 'discarded' | 'failed';
export interface TaskState {
  phase: TaskPhase; issueUrl: string; issueTitle: string; repo: string; repoPath: string; worktree: string; branch: string; base: string;
  plan?: { summary: string; steps: string[]; files: string[]; tests: string[]; risks: string[]; questions: string[] };
  notes?: string; approvedAt?: string;
  implementation?: { summary: string; changes: string[]; testsRun: string[]; testsPassed: boolean | null; followUps: string[] };
  verify?: { command: string; ok: boolean; code: number | null; output: string; durationMs: number };
  prUrl?: string; error?: string;
}

export interface QualityBucket {
  key: string; runs: number; findings: number; judged: number; accepted: number; rejected: number;
  precision: number | null; coverage: number | null; costUsd: number; costPerAccepted: number | null; medianDurationMs: number | null;
}
export interface ReviewQuality { days: number; overall: QualityBucket; bySeverity: QualityBucket[]; byVersion: QualityBucket[]; byRepo: QualityBucket[] }

export const useQuality = (days: string) => useQuery({
  queryKey: ['quality', days],
  queryFn: () => api.get<ReviewQuality>(`/api/quality?days=${days}`),
  refetchInterval: 60_000,
});

export function useSetFeedback(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (decisions: FindingDecision[]) => api.post<{ decisions: FindingDecision[] }>(`/api/runs/${id}/feedback`, { decisions }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['run', id] }); void qc.invalidateQueries({ queryKey: ['quality'] }); },
    onError: (e: Error) => toast.error(t('Não foi possível salvar'), { description: e.message }),
  });
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
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['runs'] }); toast.success(t('Review iniciada em segundo plano')); onStarted?.(r.id); },
    onError: (e: Error) => toast.error(t('Não foi possível iniciar'), { description: e.message }),
  });
}

export function useOpenReviewTerminal() {
  return useMutation({
    mutationFn: (url: string) => api.post<{ dir: string }>('/api/review/terminal', { url }),
    onSuccess: (r) => toast.success(t('Terminal aberto com o Claude'), { description: r.dir }),
    onError: (e: Error) => toast.error(t('Não foi possível abrir o terminal'), { description: e.message }),
  });
}

export function useOpenReviewCursor() {
  return useMutation({
    mutationFn: (url: string) => api.post<{ dir: string; command: string }>('/api/review/cursor', { url }),
    onSuccess: async (r) => {
      let copied = false;
      try { await navigator.clipboard.writeText(r.command); copied = true; } catch { /* sem clipboard */ }
      toast.success(t('Cursor aberto'), { description: t(copied ? 'Comando copiado — cole no chat: {cmd}' : 'Cole no chat: {cmd}', { cmd: r.command }), duration: 8000 });
    },
    onError: (e: Error) => toast.error(t('Não foi possível abrir o Cursor'), { description: e.message }),
  });
}

export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/runs/${id}/cancel`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['runs'] }); void qc.invalidateQueries({ queryKey: ['run'] }); },
    onError: (e: Error) => toast.error(t('Não foi possível cancelar'), { description: e.message }),
  });
}

export function usePendingReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ url: string; comments: number; unanchored: number }>(`/api/runs/${id}/pending-review`),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['run'] });
      toast.success(t('Review PENDING criada no GitHub'), {
        description: t('{lines} comentário(s) nas linhas · {body} no corpo. Confira e submeta no GitHub.', { lines: r.comments, body: r.unanchored }),
        action: { label: t('Abrir PR'), onClick: () => window.open(r.url, '_blank', 'noopener') }, duration: 10_000,
      });
    },
    onError: (e: Error) => toast.error(t('Não foi possível criar a review'), { description: e.message }),
  });
}

// ---------- Tarefas de ponta a ponta ----------
export interface TaskPreview { prompt: string; masked: number; features: string[]; repo: string; repoPath: string; branch: string; verify: string | null; title: string }

export function useTaskPreview() {
  return useMutation({ mutationFn: (url: string) => api.post<TaskPreview>('/api/task/preview', { url }) });
}

export function useStartTask(onStarted?: (id: string) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { url: string; prompt?: string }) => api.post<{ id: string }>('/api/task/start', b),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['runs'] }); toast.success(t('Tarefa iniciada: o agente está planejando')); onStarted?.(r.id); },
    onError: (e: Error) => toast.error(t('Não foi possível iniciar'), { description: e.message }),
  });
}

function useTaskAction<B>(path: string, ok: string, fail: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: B }) => api.post<{ ok?: boolean; url?: string }>(`/api/runs/${id}/${path}`, body ?? {}),
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: ['run', v.id] }); void qc.invalidateQueries({ queryKey: ['runs'] }); toast.success(t(ok)); },
    onError: (e: Error) => toast.error(t(fail), { description: e.message }),
  });
}

export const useApproveTask = () => useTaskAction<{ notes?: string }>('approve', k('Plano aprovado: o agente está implementando'), k('Não foi possível aprovar'));
export const useDiscardTask = () => useTaskAction<never>('discard', k('Tarefa descartada'), k('Não foi possível descartar'));
export const useTaskPr = () => useTaskAction<never>('task-pr', k('PR em rascunho criado'), k('Não foi possível criar o PR'));

export const useTaskDiff = (id: string, enabled: boolean) => useQuery({
  queryKey: ['task-diff', id],
  queryFn: () => api.get<{ base: string; commits: number; add: number; del: number; files: Array<{ path: string; add: number | null; del: number | null }>; untracked: string[] } | { error: string }>(`/api/runs/${id}/diff`),
  enabled,
});

export const useTaskPatch = (id: string, file: string | null | undefined) => useQuery({
  queryKey: ['task-patch', id, file],
  queryFn: () => api.get<string>(`/api/runs/${id}/patch${file ? `?file=${encodeURIComponent(file)}` : ''}`),
  enabled: file !== undefined,
});
