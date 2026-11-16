// Métricas de entrega do time a partir do histórico de status dos PRs (painel_prs).
// Mede o fluxo, não as pessoas: espera por review, idas e vindas de mudanças pedidas,
// tamanho dos PRs e tempo até o merge. É o "antes e depois" de qualquer mudança de processo.
//
// Limite conhecido: o início de cada PR é quando o painel o viu pela primeira vez
// (primeira entrada do histórico), não a criação no GitHub.

type When = Date | string;

export interface MetricsPr {
  url: string;
  owner: string;
  status: string;
  state: 'open' | 'closed' | 'merged';
  additions?: number | undefined;
  deletions?: number | undefined;
  mergedAt?: When | null | undefined;
  statusHistory?: Array<{ status: string; enteredAt: When; leftAt: When | null }> | undefined;
}
export interface MetricsIssue { team?: string | undefined; prs: MetricsPr[] }

export const LARGE_PR_LINES = 400;

export interface PrFacts {
  url: string;
  owner: string;
  team: string | undefined;
  merged: boolean;
  open: boolean;
  startedAt: number;
  mergedAt: number | null;
  /** do início ao merge */
  cycleMs: number | null;
  /** tempo na fila até o primeiro review */
  firstReviewWaitMs: number | null;
  /** tempo total com mudanças pedidas */
  changesRequestedMs: number;
  /** quantas vezes entrou em "mudanças pedidas" */
  changesRequestedRounds: number;
  size: number | null;
  /** aberto e ainda sem primeiro review */
  waitingReviewNow: boolean;
}

const ms = (w: When | null | undefined): number | null => (w ? new Date(w).getTime() : null);

export function prFacts(pr: MetricsPr, team: string | undefined, now: number): PrFacts | null {
  const h = pr.statusHistory ?? [];
  if (!h.length) return null;
  const startedAt = ms(h[0]!.enteredAt)!;
  const end = (e: { leftAt: When | null }) => ms(e.leftAt) ?? now;
  const firstQueue = h[0]!.status === 'review_queue' ? h[0]! : undefined;
  const reviewed = h.some(e => e.status !== 'review_queue');
  const mergedAt = pr.state === 'merged' ? (ms(pr.mergedAt) ?? ms(h.find(e => e.status === 'merged')?.enteredAt)) : null;
  const rcs = h.filter(e => e.status === 'rcs');
  const size = pr.additions !== undefined || pr.deletions !== undefined ? (pr.additions ?? 0) + (pr.deletions ?? 0) : null;
  return {
    url: pr.url,
    owner: pr.owner || '—',
    team,
    merged: pr.state === 'merged',
    open: pr.state === 'open',
    startedAt,
    mergedAt,
    cycleMs: mergedAt !== null ? Math.max(0, mergedAt - startedAt) : null,
    firstReviewWaitMs: firstQueue && reviewed ? Math.max(0, end(firstQueue) - startedAt) : null,
    changesRequestedMs: rcs.reduce((n, e) => n + Math.max(0, end(e) - ms(e.enteredAt)!), 0),
    changesRequestedRounds: rcs.length,
    size,
    waitingReviewNow: pr.state === 'open' && !reviewed,
  };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const nums = (xs: Array<number | null>) => xs.filter((x): x is number => x !== null);
const ratio = (a: number, b: number) => (b ? a / b : null);

export interface FlowSummary {
  merged: number;
  open: number;
  medianCycleMs: number | null;
  medianFirstReviewWaitMs: number | null;
  /** fração dos PRs mergeados que tiveram mudanças pedidas */
  changesRequestedRate: number | null;
  medianSize: number | null;
  /** fração dos PRs mergeados acima de LARGE_PR_LINES linhas */
  largeRate: number | null;
}

function summarize(list: PrFacts[]): FlowSummary {
  const merged = list.filter(p => p.merged);
  return {
    merged: merged.length,
    open: list.filter(p => p.open).length,
    medianCycleMs: median(nums(merged.map(p => p.cycleMs))),
    medianFirstReviewWaitMs: median(nums(list.map(p => p.firstReviewWaitMs))),
    changesRequestedRate: ratio(merged.filter(p => p.changesRequestedRounds > 0).length, merged.length),
    medianSize: median(nums(merged.map(p => p.size))),
    largeRate: ratio(merged.filter(p => (p.size ?? 0) > LARGE_PR_LINES).length, merged.filter(p => p.size !== null).length),
  };
}

export interface TeamMetrics {
  days: number;
  summary: FlowSummary;
  /** abertos esperando o primeiro review há mais de 1 dia */
  waitingOverOneDay: number;
  weeks: Array<{ week: string; merged: number; medianCycleMs: number | null; medianFirstReviewWaitMs: number | null }>;
  byOwner: Array<FlowSummary & { key: string }>;
  byTeam: Array<FlowSummary & { key: string }>;
}

/** Segunda-feira (UTC) da semana do instante, como YYYY-MM-DD. */
export function weekOf(t: number): string {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

export function computeTeamMetrics(issues: MetricsIssue[], days: number, now = Date.now()): TeamMetrics {
  const since = now - days * 86_400_000;
  const seen = new Set<string>();
  const facts: PrFacts[] = [];
  for (const i of issues) {
    for (const pr of i.prs) {
      if (seen.has(pr.url)) continue;
      seen.add(pr.url);
      const f = prFacts(pr, i.team || undefined, now);
      // Entram os mergeados no período e os ainda abertos (o retrato de agora).
      if (f && ((f.merged && (f.mergedAt ?? 0) >= since) || f.open)) facts.push(f);
    }
  }

  const weeks = new Map<string, PrFacts[]>();
  for (let t = since; t <= now; t += 7 * 86_400_000) weeks.set(weekOf(t), []);
  weeks.set(weekOf(now), weeks.get(weekOf(now)) ?? []);
  for (const f of facts) if (f.merged && f.mergedAt !== null) weeks.get(weekOf(f.mergedAt))?.push(f);

  const group = (key: (f: PrFacts) => string | undefined) => {
    const m = new Map<string, PrFacts[]>();
    for (const f of facts) { const k = key(f); if (k) m.set(k, [...(m.get(k) ?? []), f]); }
    return [...m.entries()].map(([k, l]) => ({ key: k, ...summarize(l) })).sort((a, b) => b.merged - a.merged || b.open - a.open || a.key.localeCompare(b.key));
  };

  return {
    days,
    summary: summarize(facts),
    waitingOverOneDay: facts.filter(f => f.waitingReviewNow && now - f.startedAt > 86_400_000).length,
    weeks: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, l]) => ({
      week, merged: l.length, medianCycleMs: median(nums(l.map(p => p.cycleMs))), medianFirstReviewWaitMs: median(nums(l.map(p => p.firstReviewWaitMs))),
    })),
    byOwner: group(f => f.owner),
    byTeam: group(f => f.team),
  };
}
