// Block data. The server syncs every POLL_INTERVAL_MIN; the screen re-reads the snapshot every minute.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import type { DailySummary, OpenBlocker, QueueItem, ReviewItem, Sources, SourceState, TrackedIssue } from '@/lib/board-types';

const every = 60_000;

export const useBoardStatus = () =>
  useQuery({ queryKey: ['board-status'], queryFn: () => api.get<{ sources: Sources; demo?: boolean }>('/api/board/status'), refetchInterval: 15_000 });

export const useQueue = () =>
  useQuery({ queryKey: ['queue'], queryFn: () => api.get<{ source: { github: SourceState; chat: SourceState; tracker?: SourceState }; items: QueueItem[] }>('/api/queue'), refetchInterval: every });

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
    onSuccess: (r) => { invalidatePrs(qc); toast.success(t('Issue tracked'), { description: t('{title} · {n} PR(s) found', { title: r.title, n: r.prs }) }); },
    onError: (e: Error) => toast.error(t('Could not track'), { description: e.message }),
  });
}

export function useArchiveIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => api.post(`/api/prs/${id}/archive`, { archived }),
    onSuccess: (_r, v) => { invalidatePrs(qc); toast.success(t(v.archived ? 'Stopped tracking' : 'Tracking again')); },
    onError: (e: Error) => toast.error(t('Failed'), { description: e.message }),
  });
}

export function useSetPrStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, url, status }: { id: string; url: string; status: string | null }) => api.patch(`/api/prs/${id}/pr`, { url, status }),
    onSuccess: (_r, v) => { invalidatePrs(qc); toast.success(t(v.status ? 'Status set' : 'Back to automatic|event')); },
    onError: (e: Error) => toast.error(t('Could not set it'), { description: e.message }),
  });
}

/** Syncs now (GitHub, chat, trackers and PRs) and reloads everything. */
export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ sources: Sources }>('/api/sync'),
    onSuccess: (r) => {
      void qc.invalidateQueries();
      const errors = Object.entries(r.sources).filter(([, s]) => s.error);
      if (errors.length) toast.warning(t('Synced with errors'), { description: errors.map(([k, s]) => `${k}: ${s.error}`).join(' · ') });
      else toast.success(t('Data updated'));
    },
    onError: (e: Error) => toast.error(t('Sync failed'), { description: e.message }),
  });
}

export function usePatchPr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; deployDate?: string; team?: string; owner?: string }) => api.patch<TrackedIssue>(`/api/prs/${id}`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['prs'] }); toast.success(t('Saved')); },
    onError: (e: Error) => toast.error(t('Could not save'), { description: e.message }),
  });
}
