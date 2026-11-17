// Real-time infrastructure (read-only): resources, firing alerts, deploys and events.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

export type ResourceStatus = 'ok' | 'warn' | 'down' | 'unknown';
export type AlertSeverity = 'critical' | 'warning' | 'info';
export interface MetricPoint { at: number; cpu?: number; memory?: number }
export interface InfraResourceView {
  id: string; provider: string; kind: string; name: string; status: ResourceStatus; statusText?: string;
  metrics?: { cpu?: number; memory?: number; disk?: number }; region?: string; url?: string; production: boolean; history: MetricPoint[];
}
export interface FiringAlert {
  fingerprint: string; provider: string; resourceId?: string; resourceName?: string; title: string; severity: AlertSeverity;
  startedAt: string; firstSeenAt: string; url?: string; synthetic?: boolean; incidentId?: string;
  suspect?: { title: string; at: string; version?: string };
}
export interface InfraView {
  configured: boolean; demo: boolean; pollSec: number; lastPoll?: string;
  rules: { cpuWarn: number; cpuCrit: number; memCrit: number; sustainMin: number; autoIncident: 'critical' | 'off' };
  providers: Array<{ id: string; label: string; ok: boolean | null; lastPoll?: string; error?: string; warning?: string }>;
  resources: InfraResourceView[]; firing: FiringAlert[];
  summary: { ok: number; warn: number; down: number; critical: number; warning: number };
}
export interface InfraEvent {
  _id: string; key: string; kind: 'alert_fired' | 'alert_resolved' | 'status' | 'deploy'; provider: string; at: string; title: string;
  severity?: AlertSeverity; resourceName?: string; from?: string; to?: string; durationMs?: number; incidentId?: string;
  deploy?: { status: string; version?: string };
}

export const useInfra = () => useQuery({
  queryKey: ['infra'], queryFn: () => api.get<InfraView>('/api/infra'),
  refetchInterval: q => Math.max(15, Math.min(60, q.state.data?.pollSec ?? 30)) * 1000,
});
export const useInfraEvents = (days: number) => useQuery({ queryKey: ['infra-events', days], queryFn: () => api.get<{ items: InfraEvent[] }>(`/api/infra/events?days=${days}`), refetchInterval: 60_000 });

export function useInfraRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<InfraView>('/api/infra/refresh', {}),
    onSuccess: d => { qc.setQueryData(['infra'], d); void qc.invalidateQueries({ queryKey: ['infra-events'] }); },
    onError: e => toast.error((e as Error).message),
  });
}
export function useIncidentFromAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fingerprint: string) => api.post<{ id: string }>('/api/infra/incident', { fingerprint }),
    onSuccess: () => { for (const key of ['infra', 'incidents', 'staff-alerts']) void qc.invalidateQueries({ queryKey: [key] }); toast.success(t('Incident opened from the alert')); },
    onError: e => toast.error((e as Error).message),
  });
}
