// AI review quality: how many findings the Tech Lead keeps when reviewing the result.
// Each finding gets "accepted" (worth taking to the author) or "rejected" (noise, wrong, irrelevant).
// Precision = accepted ÷ judged. Measured by prompt version, severity and repository,
// to compare skill, model or context changes with a number, not an impression.

export type FindingDecision = 'accepted' | 'rejected' | null;
export type FindingSeverity = 'blocker' | 'high' | 'medium' | 'low' | 'note';

export interface QualityRun {
  startedAt: Date | string;
  promptVersion?: string | undefined;
  model?: string | undefined;
  repo?: string | undefined;
  findings: Array<{ severity: FindingSeverity }>;
  decisions?: FindingDecision[] | undefined;
  costUsd?: number | undefined;
  durationMs?: number | undefined;
}

export interface QualityBucket {
  key: string;
  runs: number;
  findings: number;
  judged: number;
  accepted: number;
  rejected: number;
  /** accepted ÷ judged (null without a judgment) */
  precision: number | null;
  /** judged ÷ findings (null without findings) */
  coverage: number | null;
  costUsd: number;
  /** cost ÷ accepted findings (null without accepted ones) */
  costPerAccepted: number | null;
  medianDurationMs: number | null;
}

export interface ReviewQuality {
  days: number;
  overall: QualityBucket;
  bySeverity: QualityBucket[];
  byVersion: QualityBucket[];
  byRepo: QualityBucket[];
}

const SEVERITIES: FindingSeverity[] = ['blocker', 'high', 'medium', 'low', 'note'];

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

interface Acc { runs: Set<number>; findings: number; accepted: number; rejected: number; cost: number; durations: number[] }
const empty = (): Acc => ({ runs: new Set(), findings: 0, accepted: 0, rejected: 0, cost: 0, durations: [] });

function bucket(key: string, a: Acc): QualityBucket {
  const judged = a.accepted + a.rejected;
  return {
    key,
    runs: a.runs.size,
    findings: a.findings,
    judged,
    accepted: a.accepted,
    rejected: a.rejected,
    precision: judged ? a.accepted / judged : null,
    coverage: a.findings ? judged / a.findings : null,
    costUsd: Math.round(a.cost * 1e4) / 1e4,
    costPerAccepted: a.accepted ? Math.round((a.cost / a.accepted) * 1e4) / 1e4 : null,
    medianDurationMs: median(a.durations),
  };
}

/** Aggregates the finished reviews. Cost and duration count once per run in each group. */
export function computeReviewQuality(runs: QualityRun[], days: number): ReviewQuality {
  const overall = empty();
  const bySev = new Map<string, Acc>(SEVERITIES.map(s => [s, empty()]));
  const byVersion = new Map<string, Acc>();
  const byRepo = new Map<string, Acc>();
  const get = (m: Map<string, Acc>, k: string) => { let a = m.get(k); if (!a) { a = empty(); m.set(k, a); } return a; };

  runs.forEach((r, i) => {
    const groups = [overall, get(byVersion, r.promptVersion ?? 'no version'), get(byRepo, r.repo ?? 'sem repo')];
    for (const g of groups) {
      g.runs.add(i);
      g.cost += r.costUsd ?? 0;
      if (r.durationMs) g.durations.push(r.durationMs);
    }
    r.findings.forEach((f, j) => {
      const d = r.decisions?.[j] ?? null;
      const sev = get(bySev, f.severity);
      sev.runs.add(i);
      for (const g of [...groups, sev]) {
        g.findings++;
        if (d === 'accepted') g.accepted++;
        if (d === 'rejected') g.rejected++;
      }
    });
  });

  const sorted = (m: Map<string, Acc>) => [...m.entries()].map(([k, a]) => bucket(k, a)).sort((a, b) => b.runs - a.runs || a.key.localeCompare(b.key));
  return {
    days,
    overall: bucket('total', overall),
    bySeverity: SEVERITIES.map(s => bucket(s, bySev.get(s)!)).filter(b => b.findings > 0),
    byVersion: sorted(byVersion),
    byRepo: sorted(byRepo),
  };
}

/** Findings that go into the PENDING review: rejected ones stay out; without a judgment, all go. */
export function keptFindingIndexes(total: number, decisions: FindingDecision[] | undefined): number[] {
  return Array.from({ length: total }, (_, i) => i).filter(i => decisions?.[i] !== 'rejected');
}
