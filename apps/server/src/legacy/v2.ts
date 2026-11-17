// Typed adapter for the v2 modules in lib/*.js.
// Those modules stay in JavaScript because hook.js (run by Claude Code/Cursor
// on every event) must run without a build and without dependencies. See docs/adr/0002.
import { createRequire } from 'node:module';
import path from 'node:path';
import { REPO_ROOT } from '../config.js';

const require = createRequire(import.meta.url);
const lib = (name: string): unknown => require(path.join(REPO_ROOT, 'lib', name));

export interface V2Approval { requestId: string; at: number; summary: string; detail: string; remote?: boolean }
export interface V2Todo { text: string; active?: string; status: 'pending' | 'in_progress' | 'completed' }
export interface V2Usage { turns: number; total: number; cost: number; context: number; contextMax: number; model?: string }
export interface V2Session {
  id: string;
  state: 'needs_you' | 'review' | 'working' | 'idle' | 'ended' | string;
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
  todos?: V2Todo[];
  approvals?: V2Approval[];
  usage?: V2Usage;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

export interface V2Store {
  SESSIONS: string; ROOT: string; HISTORY: string; DECISIONS: string; EVENTS: string;
  safeId(id: string): string;
  sessionFile(id: string): string;
  decisionFile(id: string, requestId: string): string;
  writeJson(file: string, data: unknown): void;
  readJson<T = unknown>(file: string): T | null;
  readDir<T = unknown>(dir: string): T[];
  readEvents(sinceTs?: number): unknown[];
}

export interface V2DiffSummary {
  base: string; commits: number; add: number; del: number;
  files: Array<{ path: string; add: number | null; del: number | null }>;
  untracked: string[];
}
export interface V2Git {
  diffSummary(cwd: string): Promise<V2DiffSummary | null>;
  diffPatch(cwd: string, file?: string): Promise<string>;
  prStatus(cwd: string): Promise<unknown>;
  createPr(cwd: string): Promise<string>;
}

export interface V2LaunchInput { repo: string; branch: string; prompt: string; worktree: boolean; tool?: string }
export interface V2Launch { launch(input: V2LaunchInput): Promise<{ dir: string }> }
export interface V2Metrics { computeMetrics(events: unknown[], sessions: V2Session[], days: number): unknown }

export const v2 = {
  store: lib('store.js') as V2Store,
  git: lib('git.js') as V2Git,
  launch: lib('launch.js') as V2Launch,
  metrics: lib('metrics.js') as V2Metrics,
};
