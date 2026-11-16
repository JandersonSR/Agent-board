import { describe, expect, it } from 'vitest';
import type { AgentSession } from '@/lib/types';
import { columnOf, groupByColumn, groupByTask, isStale } from './session-meta';

const s = (id: string, state: string, updatedAt: number, extra: Partial<AgentSession> = {}): AgentSession =>
  ({ id, state, updatedAt, createdAt: 0, ...extra });

describe('session-meta', () => {
  it('mapeia estado para coluna (ended vai para ociosas)', () => {
    expect(columnOf(s('a', 'ended', 1))).toBe('idle');
    expect(columnOf(s('a', 'needs_you', 1))).toBe('needs_you');
  });

  it('quem espera há mais tempo vem primeiro nas colunas de ação', () => {
    const g = groupByColumn([s('new', 'needs_you', 200), s('old', 'needs_you', 100), s('w', 'working', 50)]);
    expect(g.needs_you.map(x => x.id)).toEqual(['old', 'new']);
    expect(g.working).toHaveLength(1);
  });

  it('detecta sessão travada após 10 min sem atividade', () => {
    const now = 1_000_000;
    expect(isStale(s('a', 'working', now - 11 * 60_000), now)).toBe(true);
    expect(isStale(s('a', 'working', now - 5 * 60_000), now)).toBe(false);
    expect(isStale(s('a', 'review', 0), now)).toBe(false);
  });

  it('agrupa por tarefa com o grupo mais urgente primeiro', () => {
    const groups = groupByTask([
      s('1', 'working', 10, { taskId: 'T-1', usage: { cost: 1, total: 0, turns: 1, context: 0, contextMax: 0 } }),
      s('2', 'needs_you', 5, { taskId: 'T-2' }),
      s('3', 'idle', 20, { taskId: 'T-1', tool: 'cursor', usage: { cost: 2, total: 0, turns: 1, context: 0, contextMax: 0 } }),
    ]);
    expect(groups.map(g => g.key)).toEqual(['T-2', 'T-1']);
    expect(groups[1]?.cost).toBe(3);
    expect(groups[1]?.tools).toBe('Claude + Cursor');
  });
});
