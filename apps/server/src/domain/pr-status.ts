// Status de deploy do PR (mesmo fluxo do painel de PRs anterior), derivado do GitHub,
// e o histórico/tempo em cada status.

export const STATUSES = ['review_queue', 'reviewing', 'rcs', 'waiting_approves', 'merged'] as const;
export type DeployStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<DeployStatus, string> = {
  review_queue: 'Fila de review',
  reviewing: 'Em review',
  rcs: 'RCs (mudanças pedidas)',
  waiting_approves: 'Aguardando aprovações',
  merged: 'Merged',
};

export interface GhPrState {
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  /** Total de reviews/comentários de review já feitos (qualquer estado). */
  reviewCount: number;
}

/**
 * - merged → merged
 * - mudanças pedidas → rcs
 * - aprovado (ainda aberto: falta aprovação extra, checks ou o merge) → waiting_approves
 * - já tem review mas sem decisão → reviewing
 * - nenhum review → review_queue
 * PR fechado sem merge devolve null (sai do acompanhamento).
 */
export function deriveStatus(pr: GhPrState): DeployStatus | null {
  if (pr.state === 'MERGED') return 'merged';
  if (pr.state === 'CLOSED') return null;
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'rcs';
  if (pr.reviewDecision === 'APPROVED') return 'waiting_approves';
  if (pr.reviewCount > 0) return 'reviewing';
  return 'review_queue';
}

/** Status do grupo (issue) = o PR menos avançado ainda aberto; todos merged → merged. */
export function groupStatus(statuses: DeployStatus[]): DeployStatus | null {
  if (!statuses.length) return null;
  const open = statuses.filter(s => s !== 'merged');
  if (!open.length) return 'merged';
  return open.reduce((min, s) => (STATUSES.indexOf(s) < STATUSES.indexOf(min) ? s : min));
}

export interface StatusHistoryEntry { status: DeployStatus; enteredAt: Date; leftAt: Date | null }
export type StatusStats = Partial<Record<Exclude<DeployStatus, 'merged'>, { count: number; totalMs: number }>>;

export interface Tracked { status: DeployStatus; statusHistory?: StatusHistoryEntry[]; statusStats?: StatusStats }

/** Aplica uma transição (idempotente se o status não mudou) e atualiza o tempo por status. */
export function enterStatus<T extends Tracked>(doc: T, next: DeployStatus, at: Date = new Date()): T {
  if (doc.status === next && doc.statusHistory?.length) return doc;
  const history = [...(doc.statusHistory ?? [])];
  const stats: StatusStats = { ...(doc.statusStats ?? {}) };
  const last = history[history.length - 1];
  if (last && !last.leftAt) {
    history[history.length - 1] = { ...last, leftAt: at };
    if (last.status !== 'merged') {
      const prev = stats[last.status] ?? { count: 0, totalMs: 0 };
      stats[last.status] = { count: prev.count + 1, totalMs: prev.totalMs + Math.max(0, at.getTime() - new Date(last.enteredAt).getTime()) };
    }
  }
  history.push({ status: next, enteredAt: at, leftAt: null });
  return { ...doc, status: next, statusHistory: history, statusStats: stats };
}
