import { describe, expect, it } from 'vitest';
import { parseTypeOrder, sortQueue, typeRank } from './priority.js';

const rules = parseTypeOrder();

describe('queue priority', () => {
  it('follows Ticket > Bug > Ajuste > Tarefa', () => {
    expect(typeRank(rules, 'Ticket')).toBe(0);
    expect(typeRank(rules, 'Bug')).toBe(1);
    expect(typeRank(rules, 'Minor Fix')).toBe(2);
    expect(typeRank(rules, 'Ajustes')).toBe(2);
    expect(typeRank(rules, 'Task')).toBe(3);
  });

  it('production errors and problems count as Bug; "Ajustes Cliente" as Fix', () => {
    expect(typeRank(rules, 'Production Error')).toBe(1);
    expect(typeRank(rules, 'Problem')).toBe(1);
    expect(typeRank(rules, 'Ajustes Cliente')).toBe(2);
  });

  it('an unknown type goes to the end; labels/channel are used as a hint', () => {
    expect(typeRank(rules, 'Feature')).toBe(4);
    expect(typeRank(rules, undefined, 'suporte')).toBe(0);
    expect(typeRank(rules, null, 'bug')).toBe(1);
  });

  it('does not confuse similar words', () => {
    expect(typeRank(rules, 'Debugging session')).toBe(4); // "bug" only as a whole word
    expect(typeRank(rules, 'fixture')).toBe(4);
  });

  it('sorts by type and then from oldest to newest', () => {
    const items = [
      { id: 'tarefa-velha', rank: 3, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'bug-novo', rank: 1, createdAt: '2026-11-10T00:00:00Z' },
      { id: 'bug-velho', rank: 1, createdAt: '2026-10-01T00:00:00Z' },
      { id: 'ticket', rank: 0, createdAt: '2026-11-15T00:00:00Z' },
    ];
    expect(sortQueue(items).map(i => i.id)).toEqual(['ticket', 'bug-velho', 'bug-novo', 'tarefa-velha']);
  });

  it('accepts a custom order', () => {
    const custom = parseTypeOrder('bug;ticket');
    expect(typeRank(custom, 'Ticket')).toBe(1);
  });
});
