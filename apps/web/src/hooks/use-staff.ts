// Staff view data: DORA, knowledge, incidents, decisions, product and AI evaluation.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { k, t } from '@/lib/i18n';

// ---------- Tipos (espelham o servidor) ----------
export interface Dora {
  configured: boolean; days: number; failureRe?: string;
  deploys: { items: number; days: number; itemsPerWeek: number; daysPerWeek: number; source?: 'issues' | 'infra'; real?: { count: number; days: number; perWeek: number } };
  leadTime: { medianMs: number | null; p90Ms: number | null; measured: number };
  changeFailure: { failures: number; rate: number | null; fixes: number; incidents: number };
  recovery: { resolved: number; medianMs: number | null; medianDetectMs: number | null; open: number };
  weeks: Array<{ week: string; deploys: number; deployDays: number; failures: number; medianLeadMs: number | null }>;
  failures: Array<{ key: string; title: string; deployDate: string; reasons: Array<'fix' | 'incident'> }>;
}

export type KnowledgeRisk = 'high' | 'medium' | 'low';
export interface RepoKnowledge {
  repo: string; prs: number; busFactor: number; risk: KnowledgeRisk; lowData: boolean;
  authors: Array<{ name: string; prs: number }>; reviewers: Array<{ name: string; prs: number }>;
  topAuthorShare: number | null; topReviewerShare: number | null; unreviewed: number; unknownReviewers: number;
}
export interface Knowledge {
  configured: boolean; days: number; prs: number; withReviewerData: number; repos: RepoKnowledge[];
  people: Array<{ name: string; authored: number; reviewed: number; repos: number; soleReviewerOf: string[] }>;
}

export const SEVERITIES = ['sev1', 'sev2', 'sev3', 'sev4'] as const;
export type Severity = (typeof SEVERITIES)[number];
export type IncidentStatus = 'open' | 'mitigated' | 'resolved';
export type PostmortemStatus = 'pending' | 'draft' | 'done' | 'not_needed';
export interface IncidentAction { id: string; text: string; owner?: string; due?: string; done: boolean; doneAt?: string }
export interface Incident {
  _id: string; title: string; severity: Severity; status: IncidentStatus;
  startedAt: string; detectedAt?: string | null; mitigatedAt?: string | null; resolvedAt?: string | null;
  impact?: string; services: string[]; causeChanges: string[]; fixChanges: string[];
  timeline: Array<{ at: string; text: string }>; actions: IncidentAction[];
  postmortem: { status: PostmortemStatus; url?: string; whatHappened?: string; rootCause?: string; wentWell?: string; wentWrong?: string; lessons?: string };
  createdAt: string; updatedAt: string;
}
export interface IncidentAlerts {
  open: number; openActions: number; actionsDoneRate: number | null;
  overdueActions: Array<{ incident: string; title: string; action: string; owner?: string; due: string }>;
  postmortemPending: Array<{ incident: string; title: string; severity: Severity }>;
}

export const DECISION_STATUSES = ['proposed', 'discussing', 'decided', 'rejected', 'superseded'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export type DecisionKind = 'adr' | 'design_doc' | 'rfc';
export interface Decision {
  _id: string; title: string; kind: DecisionKind; status: DecisionStatus; owner?: string; deciders: string[];
  url?: string; repo?: string; path?: string; context?: string; decision?: string;
  decideBy?: string; decidedAt?: string; date?: string; source: 'manual' | 'repo'; createdAt: string; updatedAt: string;
}
export interface DecisionAlerts { open: number; overdue: number; stale: number; dueSoon: number }

export type StageStatus = 'not_started' | 'in_progress' | 'blocked' | 'done';
export type RiskLevel = 'high' | 'medium' | 'low';
export interface Stage {
  id: string; name: string; owners: string[]; status: StageStatus; dependsOn: string[]; issues: string[];
  query?: string; targetDate?: string; notes?: string; risks: Array<{ text: string; level: RiskLevel; mitigation?: string }>;
}
export interface StageView extends Stage {
  matched: Array<{ key: string; title: string; status: string; deployDate?: string; deployed: boolean }>;
  merged: number; deployed: number; progress: number | null; waitingOn: string[]; late: boolean; critical: boolean;
}
export type InitiativeStatus = 'planned' | 'active' | 'paused' | 'done';
export interface Initiative {
  _id: string; name: string; goal?: string; status: InitiativeStatus; targetDate?: string; stages: Stage[];
  view: { stages: StageView[]; criticalPath: string[]; progress: number; doneStages: number; highRisks: number; blocked: number; late: number };
}

export interface StaffAlerts {
  configured: boolean;
  incidents?: IncidentAlerts; decisions?: DecisionAlerts;
  initiatives?: Array<{ _id: string; name: string; progress: number; late: number; blocked: number; highRisks: number }>;
  infra?: { ok: number; warn: number; down: number; critical: number; warning: number };
}

export interface ExpectedFinding { id: string; path?: string; line?: number; keywords: string[]; note?: string }
export interface EvalCase { _id: string; name: string; prUrl: string; expected: ExpectedFinding[] }
export interface VersionRecall {
  version: string; cases: number; expected: number; found: number; recall: number | null; extraPerCase: number | null; costUsd: number;
  perCase: Array<{ caseId: string; found: number; expected: number; missed: string[]; extra: number }>;
}
export interface EvalSummary {
  currentVersion: string; cases: EvalCase[]; versions: VersionRecall[];
  state: { running: boolean; total: number; done: number; current?: string; error?: string };
}

// ---------- Leitura ----------
export const useDora = (days: string) => useQuery({ queryKey: ['dora', days], queryFn: () => api.get<Dora>(`/api/dora?days=${days}`), refetchInterval: 5 * 60_000 });
export const useKnowledge = (days: string) => useQuery({ queryKey: ['knowledge', days], queryFn: () => api.get<Knowledge>(`/api/knowledge?days=${days}`), refetchInterval: 10 * 60_000 });
export const useIncidents = () => useQuery({ queryKey: ['incidents'], queryFn: () => api.get<{ configured: boolean; items: Incident[]; alerts: IncidentAlerts }>('/api/incidents') });
export const useDecisions = () => useQuery({ queryKey: ['decisions'], queryFn: () => api.get<{ configured: boolean; items: Decision[]; alerts: DecisionAlerts }>('/api/decisions') });
export const useInitiatives = () => useQuery({ queryKey: ['initiatives'], queryFn: () => api.get<{ configured: boolean; today?: string; items: Initiative[] }>('/api/initiatives'), refetchInterval: 5 * 60_000 });
export const useStaffAlerts = () => useQuery({ queryKey: ['staff-alerts'], queryFn: () => api.get<StaffAlerts>('/api/staff/alerts'), refetchInterval: 5 * 60_000 });
export const useEvals = () => useQuery({
  queryKey: ['evals'], queryFn: () => api.get<EvalSummary>('/api/evals'),
  refetchInterval: q => (q.state.data?.state.running ? 5_000 : 60_000), retry: false,
});

// ---------- Escrita ----------
/** A mutation that invalidates the related queries and shows the toast. Messages are translation keys. */
function useWrite<V, R = unknown>(fn: (v: V) => Promise<R>, keys: string[], ok?: string, fail = k('Could not save')) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { for (const key of [...keys, 'staff-alerts']) void qc.invalidateQueries({ queryKey: [key] }); if (ok) toast.success(t(ok)); },
    onError: (e: Error) => toast.error(t(fail), { description: e.message }),
  });
}

export type IncidentInput = Partial<Omit<Incident, '_id' | 'createdAt' | 'updatedAt'>>;
export const useSaveIncident = () => useWrite(
  ({ id, body }: { id?: string; body: IncidentInput }) => (id ? api.patch<unknown>(`/api/incidents/${id}`, body) : api.post<unknown>("/api/incidents", body)),
  ['incidents', 'dora'], k('Incident saved'),
);
export const useDeleteIncident = () => useWrite((id: string) => api.del(`/api/incidents/${id}`), ['incidents', 'dora'], k('Incident deleted'), k('Could not delete'));

export type DecisionInput = Partial<Pick<Decision, 'title' | 'kind' | 'status' | 'owner' | 'deciders' | 'url' | 'context' | 'decision' | 'decideBy' | 'decidedAt'>>;
export const useSaveDecision = () => useWrite(
  ({ id, body }: { id?: string; body: DecisionInput }) => (id ? api.patch(`/api/decisions/${id}`, body) : api.post('/api/decisions', body)),
  ['decisions'], k('Decision saved'),
);
export const useDeleteDecision = () => useWrite((id: string) => api.del(`/api/decisions/${id}`), ['decisions'], k('Decision deleted'), k('Could not delete'));
export const useImportAdrs = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ repos: number; files: number; added: number; updated: number }>('/api/decisions/import'),
    onSuccess: r => {
      void qc.invalidateQueries({ queryKey: ['decisions'] });
      toast.success(t('{files} ADRs in {repos} repositories: {added} new, {updated} updated', r));
    },
    onError: (e: Error) => toast.error(t('Could not import'), { description: e.message }),
  });
};

export type InitiativeInput = Partial<Pick<Initiative, 'name' | 'goal' | 'status' | 'targetDate' | 'stages'>>;
export const useSaveInitiative = () => useWrite(
  ({ id, body }: { id?: string; body: InitiativeInput }) => (id ? api.patch(`/api/initiatives/${id}`, body) : api.post('/api/initiatives', body)),
  ['initiatives'], k('Initiative saved'),
);
export const useDeleteInitiative = () => useWrite((id: string) => api.del(`/api/initiatives/${id}`), ['initiatives'], k('Initiative deleted'), k('Could not delete'));

export const useSaveEvalCase = () => useWrite(
  ({ id, body }: { id?: string; body: Omit<EvalCase, '_id'> }) => (id ? api.put(`/api/evals/${id}`, body) : api.post('/api/evals', body)),
  ['evals'], k('Case saved'),
);
export const useDeleteEvalCase = () => useWrite((id: string) => api.del(`/api/evals/${id}`), ['evals'], k('Case deleted'), k('Could not delete'));
export const useRunEvals = () => useWrite((ids?: string[]) => api.post<{ total: number }>('/api/evals/run', ids ? { ids } : {}), ['evals', 'runs'], k('Evaluation started'), k('Could not start'));
