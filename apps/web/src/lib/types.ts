// Formatos devolvidos pela API (espelham apps/server/src/legacy/v2.ts e routes/health.ts).
export type SessionState = 'needs_you' | 'review' | 'working' | 'idle' | 'ended';

export interface Approval { requestId: string; at: number; summary: string; detail: string; remote?: boolean }
export interface Todo { text: string; active?: string; status: 'pending' | 'in_progress' | 'completed' }
export interface Usage { turns: number; total: number; cost: number; context: number; contextMax: number; model?: string }

export interface AgentSession {
  id: string;
  state: SessionState | string;
  tool?: 'claude' | 'cursor';
  project?: string;
  cwd?: string;
  branch?: string;
  taskId?: string;
  title?: string;
  task?: string;
  message?: string;
  notice?: string;
  mode?: string;
  lastTool?: string;
  checkpoint?: string;
  toolCount?: number;
  subagents?: number;
  compactions?: number;
  files?: string[];
  todos?: Todo[];
  approvals?: Approval[];
  usage?: Usage;
  createdAt: number;
  updatedAt: number;
}

export interface DiffSummary {
  base: string; commits: number; add: number; del: number;
  files: Array<{ path: string; add: number | null; del: number | null }>;
  untracked: string[];
}
export type DiffResponse = DiffSummary | { error: string };

export interface PrInfo {
  url: string; number: number; state: string; draft?: boolean; review?: string;
  checks?: { pass?: number; fail?: number; pending?: number };
}
export type PrStatus = { none: true } | { error: string } | PrInfo;

export interface Metrics {
  sessions: number; waitingOnYou: number; needsYou: number; review: number; working: number;
  medianResponse: number; asks: number; cost: number; tokens: number;
  perDay: Array<{ date: string; working: number; waiting: number }>;
  tasks: Array<{ key: string; project?: string; sessions: number; working: number; waiting: number; cost: number; tokens: number; lastTs: number }>;
}

export type CheckState = 'ok' | 'warn' | 'off' | 'error';
export interface HealthCheck { id: string; label: string; state: CheckState; detail: string; hint?: string }
export interface Health {
  checks: HealthCheck[];
  limits: { maxConcurrent: number; timeoutMin: number; maxDailyRuns: number; pollIntervalMin: number };
}
