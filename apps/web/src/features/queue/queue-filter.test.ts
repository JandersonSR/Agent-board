import { describe, expect, it } from 'vitest';
import type { QueueItem } from '@/lib/board-types';
import { filterQueue, typeTabs } from './queue-filter';

const q = (key: string, type: string, rank: number, created: string, extra: Partial<QueueItem> = {}): QueueItem => ({
  key, source: 'github', kind: 'issue', type, rank, title: `title ${key}`, url: `https://x/${key}`, labels: [],
  createdAt: created, updatedAt: created, reasons: ['assigned'], answered: true, ...extra,
});

const all = [
  q('a', 'Bug', 1, '2026-11-10T00:00:00Z', { repo: 'acme/loans-api', number: 431, updatedAt: '2026-11-16T00:00:00Z' }),
  q('b', 'Ticket', 0, '2026-11-15T00:00:00Z', { reasons: ['mentioned'], answered: false }),
  q('c', 'bug', 1, '2026-11-12T00:00:00Z', { source: 'jira', origin: 'Jira · LOAN-9', labels: ['payments'] }),
  q('d', 'Story', 4, '2026-11-01T00:00:00Z', { source: 'linear', updatedAt: '2026-11-02T00:00:00Z' }),
  q('e', 'Ticket', 0, '2026-11-14T00:00:00Z', { source: 'chat', kind: 'message', reasons: ['mentioned'], answered: true }),
];
const base = { type: 'all', query: '', origin: 'all' as const, unanswered: false, sort: 'priority' as const };
const keys = (xs: QueueItem[]) => xs.map(x => x.key);

describe('typeTabs', () => {
  it('one tab per type, case-insensitive, in priority order with counts', () => {
    expect(typeTabs(all).map(t => [t.id, t.count])).toEqual([['ticket', 2], ['bug', 2], ['story', 1]]);
  });
});

describe('filterQueue', () => {
  it('priority order: rank, then oldest first', () => {
    expect(keys(filterQueue(all, base))).toEqual(['e', 'b', 'a', 'c', 'd']);
  });

  it('by type, origin and unanswered', () => {
    expect(keys(filterQueue(all, { ...base, type: 'bug' }))).toEqual(['a', 'c']);
    expect(keys(filterQueue(all, { ...base, origin: 'jira' }))).toEqual(['c']);
    expect(keys(filterQueue(all, { ...base, unanswered: true }))).toEqual(['b']);
  });

  it('text matches title, origin, repo#number and labels', () => {
    expect(keys(filterQueue(all, { ...base, query: 'LOAN-9' }))).toEqual(['c']);
    expect(keys(filterQueue(all, { ...base, query: 'loans-api#431' }))).toEqual(['a']);
    expect(keys(filterQueue(all, { ...base, query: 'PAYMENTS' }))).toEqual(['c']);
    expect(keys(filterQueue(all, { ...base, query: 'title d' }))).toEqual(['d']);
  });

  it('oldest created and longest without update', () => {
    expect(keys(filterQueue(all, { ...base, sort: 'oldest' }))).toEqual(['d', 'a', 'c', 'e', 'b']);
    expect(keys(filterQueue(all, { ...base, sort: 'stale' }))).toEqual(['d', 'c', 'e', 'b', 'a']);
  });
});
