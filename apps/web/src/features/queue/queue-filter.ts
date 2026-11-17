// Queue filters: one tab per item type (in priority order), then text, origin, "unanswered" and the chosen order.
import type { QueueItem } from '@/lib/board-types';

export type QueueSort = 'priority' | 'oldest' | 'stale';
export type QueueOrigin = 'all' | QueueItem['source'];

export interface TypeTab { id: string; label: string; rank: number; count: number }

/** Tab id of an item: its type, case-insensitive ("Bug" and "bug" are the same tab). */
export const typeId = (i: Pick<QueueItem, 'type'>) => (i.type || '').trim().toLowerCase() || 'other';

/** One tab per type present, highest priority first (the server's rank follows QUEUE_TYPE_ORDER), then by name. */
export function typeTabs(items: QueueItem[]): TypeTab[] {
  const tabs = new Map<string, TypeTab>();
  for (const i of items) {
    const id = typeId(i);
    const tab = tabs.get(id);
    if (tab) { tab.count++; tab.rank = Math.min(tab.rank, i.rank); } else tabs.set(id, { id, label: i.type || 'Other', rank: i.rank, count: 1 });
  }
  return [...tabs.values()].sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
}

const ts = (s: string) => Date.parse(s) || 0;

/** Items of the chosen type that match the text, origin and "unanswered", in the chosen order. */
export function filterQueue(
  items: QueueItem[],
  f: { type: string; query: string; origin: QueueOrigin; unanswered: boolean; sort: QueueSort },
): QueueItem[] {
  const q = f.query.trim().toLowerCase();
  const out = items.filter(i => (f.type === 'all' || typeId(i) === f.type)
    && (f.origin === 'all' || i.source === f.origin)
    && (!f.unanswered || (i.reasons.includes('mentioned') && !i.answered))
    && (!q || [i.title, i.origin, i.repo && `${i.repo}#${i.number ?? ''}`, i.author, ...i.labels].some(v => v?.toLowerCase().includes(q))));
  if (f.sort === 'oldest') return out.sort((a, b) => ts(a.createdAt) - ts(b.createdAt));
  if (f.sort === 'stale') return out.sort((a, b) => ts(a.updatedAt) - ts(b.updatedAt));
  return out.sort((a, b) => a.rank - b.rank || ts(a.createdAt) - ts(b.createdAt));
}
