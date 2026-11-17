// Status de deploy do PR (mesmo fluxo do painel de PRs anterior), derivado do GitHub,
// e o histórico/tempo em cada status.

export const STATUSES = ['review_queue', 'reviewing', 'rcs', 're_review', 'waiting_approves', 'merged', 'production'] as const;
export type DeployStatus = (typeof STATUSES)[number];

/** Status finais: já entregue (merged) ou já em produção. Não contam tempo e saem da lista "abertos". */
export const DONE_STATUSES: readonly DeployStatus[] = ['merged', 'production'];
export const isDone = (s: DeployStatus | undefined | null): boolean => !!s && DONE_STATUSES.includes(s);

/**
 * Branch de produção? Padrões separados por vírgula, com * no fim como curinga ("production*", "jobs").
 * Merge numa delas = já em produção.
 */
export function prodBranchMatcher(patterns: string[]): (base: string | undefined) => boolean {
  const res = patterns.map(p => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i'));
  return base => !!base && res.some(r => r.test(base));
}

export const STATUS_LABEL: Record<DeployStatus, string> = {
  review_queue: 'Fila de review',
  reviewing: 'Em review',
  rcs: 'RCs (mudanças pedidas)',
  re_review: 'Re-review',
  waiting_approves: 'Aguardando aprovações',
  merged: 'Merged',
  production: 'Em produção',
};

export interface GhPrState {
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  /** Total de reviews/comentários de review já feitos (qualquer estado). */
  reviewCount: number;
  /** Último review com mudanças pedidas (ISO). */
  lastChangesRequestedAt?: string | null | undefined;
  /** Último commit do PR (ISO). */
  lastCommitAt?: string | null | undefined;
  /** Último pedido de review (ISO). */
  lastReviewRequestedAt?: string | null | undefined;
  /** Mergeado numa branch de produção (ver prodBranchMatcher). */
  intoProduction?: boolean | undefined;
}

const after = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && Date.parse(a) > Date.parse(b);

/**
 * - merged numa branch de produção → production
 * - merged → merged
 * - mudanças pedidas e, depois delas, commit novo ou review pedido de novo → re_review
 * - mudanças pedidas → rcs
 * - aprovado (ainda aberto: falta aprovação extra, checks ou o merge) → waiting_approves
 * - já tem review mas sem decisão → reviewing
 * - nenhum review → review_queue
 * PR fechado sem merge devolve null (sai do acompanhamento).
 */
export function deriveStatus(pr: GhPrState): DeployStatus | null {
  if (pr.state === 'MERGED') return pr.intoProduction ? 'production' : 'merged';
  if (pr.state === 'CLOSED') return null;
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    const rc = pr.lastChangesRequestedAt;
    return after(pr.lastCommitAt, rc) || after(pr.lastReviewRequestedAt, rc) ? 're_review' : 'rcs';
  }
  if (pr.reviewDecision === 'APPROVED') return 'waiting_approves';
  if (pr.reviewCount > 0) return 'reviewing';
  return 'review_queue';
}

/**
 * Status do grupo (issue) = o PR menos avançado ainda aberto. Todos entregues: production se algum já
 * está em produção (ex.: PR na main + PR na production), senão merged.
 */
export function groupStatus(statuses: DeployStatus[]): DeployStatus | null {
  if (!statuses.length) return null;
  const open = statuses.filter(s => !isDone(s));
  if (!open.length) return statuses.includes('production') ? 'production' : 'merged';
  return open.reduce((min, s) => (STATUSES.indexOf(s) < STATUSES.indexOf(min) ? s : min));
}

export interface StatusHistoryEntry { status: DeployStatus; enteredAt: Date; leftAt: Date | null }
export type StatusStats = Partial<Record<Exclude<DeployStatus, 'merged' | 'production'>, { count: number; totalMs: number }>>;

export interface Tracked { status: DeployStatus; statusHistory?: StatusHistoryEntry[]; statusStats?: StatusStats }

/** Aplica uma transição (idempotente se o status não mudou) e atualiza o tempo por status. */
export function enterStatus<T extends Tracked>(doc: T, next: DeployStatus, at: Date = new Date()): T {
  if (doc.status === next && doc.statusHistory?.length) return doc;
  const history = [...(doc.statusHistory ?? [])];
  const stats: StatusStats = { ...(doc.statusStats ?? {}) };
  const last = history[history.length - 1];
  if (last && !last.leftAt) {
    history[history.length - 1] = { ...last, leftAt: at };
    if (last.status !== 'merged' && last.status !== 'production') {
      const prev = stats[last.status] ?? { count: 0, totalMs: 0 };
      stats[last.status] = { count: prev.count + 1, totalMs: prev.totalMs + Math.max(0, at.getTime() - new Date(last.enteredAt).getTime()) };
    }
  }
  history.push({ status: next, enteredAt: at, leftAt: null });
  return { ...doc, status: next, statusHistory: history, statusStats: stats };
}

// ---------- Ajuste manual ----------
/**
 * Status escolhido à mão vale enquanto o GitHub continuar no mesmo estado em que estava quando
 * foi marcado ("basis"). Se o derivado mudar (novo review, aprovação, merge), o ajuste cai sozinho.
 * "production" marcado à mão sobre um PR merged vale até o fim (o GitHub não sabe quando subiu para
 * produção); "production" vindo do GitHub é final e derruba qualquer ajuste.
 */
export interface StatusOverride { status: DeployStatus; at: string; basis: DeployStatus }

export function effectiveStatus(derived: DeployStatus, override: StatusOverride | null | undefined): { status: DeployStatus; override: StatusOverride | null } {
  if (!override) return { status: derived, override: null };
  if (derived === 'production' || override.basis !== derived) return { status: derived, override: null };
  return { status: override.status, override };
}
