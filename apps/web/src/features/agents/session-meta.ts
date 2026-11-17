import type { Tone } from '@/components/common';
import { k } from '@/lib/i18n';
import type { AgentSession } from '@/lib/types';

export type Column = 'needs_you' | 'review' | 'working' | 'idle';

// title and empty are translation keys (English text).
export const COLUMNS: Array<{ id: Column; title: string; empty: string; tone: Tone }> = [
  { id: 'needs_you', title: k('Needs you'), empty: k('No agent is waiting for you.'), tone: 'danger' },
  { id: 'review', title: k('Ready for review'), empty: k('Nothing to review right now.'), tone: 'warning' },
  { id: 'working', title: k('Working'), empty: k('No agent is working.'), tone: 'info' },
  { id: 'idle', title: k('Idle and ended'), empty: k('No idle sessions.'), tone: 'neutral' },
];

export const STALE_MIN = 10;
export const PROTECTED_BRANCH = /^(main|master|develop|production.*)$/;

export const columnOf = (s: AgentSession): Column =>
  s.state === 'needs_you' || s.state === 'review' || s.state === 'working' ? s.state : 'idle';

export const isStale = (s: AgentSession, now = Date.now()) => s.state === 'working' && now - s.updatedAt > STALE_MIN * 60_000;

export const STATE_ORDER: Record<string, number> = { needs_you: 0, review: 1, working: 2, idle: 3, ended: 4 };

/** Groups by column; in the columns that ask for action, whoever has waited longest comes first. */
export function groupByColumn(sessions: AgentSession[]): Record<Column, AgentSession[]> {
  const g: Record<Column, AgentSession[]> = { needs_you: [], review: [], working: [], idle: [] };
  for (const s of sessions) g[columnOf(s)].push(s);
  g.needs_you.sort((a, b) => a.updatedAt - b.updatedAt);
  g.review.sort((a, b) => a.updatedAt - b.updatedAt);
  return g;
}

export function groupByTask(sessions: AgentSession[]): Array<{ key: string; list: AgentSession[]; cost: number; tools: string }> {
  const groups = new Map<string, AgentSession[]>();
  for (const s of sessions) {
    const key = s.taskId || s.project || 'No task';
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const rank = (l: AgentSession[]) => Math.min(...l.map(s => STATE_ORDER[s.state] ?? 5));
  const latest = (l: AgentSession[]) => Math.max(...l.map(s => s.updatedAt));
  return [...groups.entries()]
    .sort((a, b) => rank(a[1]) - rank(b[1]) || latest(b[1]) - latest(a[1]))
    .map(([key, list]) => ({
      key,
      list: [...list].sort((a, b) => (STATE_ORDER[a.state] ?? 5) - (STATE_ORDER[b.state] ?? 5) || b.updatedAt - a.updatedAt),
      cost: list.reduce((n, s) => n + (s.usage?.cost ?? 0), 0),
      tools: [...new Set(list.map(s => (s.tool === 'cursor' ? 'Cursor' : 'Claude')))].join(' + '),
    }));
}
