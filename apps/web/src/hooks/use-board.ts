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

export interface PrsResponse { source: SourceState; items: TrackedIssue[]; projectScope: boolean | null; projects: number }
export const usePrs = (all = false) =>
  useQuery({ queryKey: ['prs', all], queryFn: () => api.get<PrsResponse>(`/api/prs${all ? '?all=1' : ''}`), refetchInterval: every });

const invalidatePrs = (qc: ReturnType<typeof useQueryClient>) => void qc.invalidateQueries({ queryKey: ['prs'] });

export function useTrackIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { issue: string; deployDate?: string }) => api.post<{ key: string; title: string; prs: number }>('/api/prs', body),
    onSuccess: (r) => { invalidatePrs(qc); toast.success('Issue acompanhada', { description: `${r.title} · ${r.prs} PR(s) encontrados` }); },
    onError: (e: Error) => toast.error('Não foi possível acompanhar', { description: e.message }),
  });
}

export function useArchiveIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => api.post(`/api/prs/${id}/archive`, { archived }),
    onSuccess: (_r, v) => { invalidatePrs(qc); toast.success(v.archived ? 'Parou de acompanhar' : 'Voltou a acompanhar'); },
    onError: (e: Error) => toast.error('Falhou', { description: e.message }),
  });
}

export function useSetPrStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, url, status }: { id: string; url: string; status: string | null }) => api.patch(`/api/prs/${id}/pr`, { url, status }),
    onSuccess: (_r, v) => { invalidatePrs(qc); toast.success(v.status ? 'Status ajustado' : 'Voltou ao automático'); },
    onError: (e: Error) => toast.error('Não foi possível ajustar', { description: e.message }),
  });
}

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
