// Dados dos blocos. O servidor sincroniza a cada POLL_INTERVAL_MIN; a tela relê o snapshot a cada minuto.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { DailySummary, OpenBlocker, QueueItem, ReviewItem, Sources, SourceState, TrackedIssue } from '@/lib/board-types';

const every = 60_000;

export const useBoardStatus = () =>
  useQuery({ queryKey: ['board-status'], queryFn: () => api.get<{ sources: Sources }>('/api/board/status'), refetchInterval: 15_000 });

export const useQueue = () =>
  useQuery({ queryKey: ['queue'], queryFn: () => api.get<{ source: { github: SourceState; discord: SourceState }; items: QueueItem[] }>('/api/queue'), refetchInterval: every });

export const useReviews = () =>
  useQuery({ queryKey: ['reviews'], queryFn: () => api.get<{ source: SourceState; items: ReviewItem[] }>('/api/reviews'), refetchInterval: every });

export const useDaily = () =>
  useQuery({ queryKey: ['daily'], queryFn: () => api.get<{ source: SourceState; summary: DailySummary | null }>('/api/daily'), refetchInterval: every });

export const useBlockers = () =>
  useQuery({ queryKey: ['blockers'], queryFn: () => api.get<{ source: SourceState; items: OpenBlocker[] }>('/api/blockers'), refetchInterval: every });

export const usePrs = (all = false) =>
  useQuery({ queryKey: ['prs', all], queryFn: () => api.get<{ source: SourceState; items: TrackedIssue[] }>(`/api/prs${all ? '?all=1' : ''}`), refetchInterval: every });

/** Sincroniza agora (GitHub + Discord + PRs) e recarrega tudo. */
export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ sources: Sources }>('/api/sync'),
    onSuccess: (r) => {
      void qc.invalidateQueries();
      const errors = Object.entries(r.sources).filter(([, s]) => s.error);
      if (errors.length) toast.warning('Sincronizado com falhas', { description: errors.map(([k, s]) => `${k}: ${s.error}`).join(' · ') });
      else toast.success('Dados atualizados');
    },
    onError: (e: Error) => toast.error('Falha ao sincronizar', { description: e.message }),
  });
}

export function usePatchPr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; deployDate?: string; team?: string; owner?: string }) => api.patch<TrackedIssue>(`/api/prs/${id}`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['prs'] }); toast.success('Salvo'); },
    onError: (e: Error) => toast.error('Não foi possível salvar', { description: e.message }),
  });
}
