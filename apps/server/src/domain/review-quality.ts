// Qualidade da review por IA: quanto dos achados o Tech Lead mantém ao revisar o resultado.
// Cada achado recebe "accepted" (vale a pena levar ao autor) ou "rejected" (ruído, errado, irrelevante).
// Precisão = aceitos ÷ julgados. Medida por versão do prompt, severidade e repositório,
// para comparar mudanças de skill, modelo ou contexto com número, e não com impressão.

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
  /** aceitos ÷ julgados (null sem julgamento) */
  precision: number | null;
  /** julgados ÷ achados (null sem achados) */
  coverage: number | null;
  costUsd: number;
  /** custo ÷ achados aceitos (null sem aceitos) */
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

/** Agrega as reviews concluídas. Custo e duração entram uma vez por execução em cada grupo. */
export function computeReviewQuality(runs: QualityRun[], days: number): ReviewQuality {
  const overall = empty();
  const bySev = new Map<string, Acc>(SEVERITIES.map(s => [s, empty()]));
  const byVersion = new Map<string, Acc>();
  const byRepo = new Map<string, Acc>();
  const get = (m: Map<string, Acc>, k: string) => { let a = m.get(k); if (!a) { a = empty(); m.set(k, a); } return a; };

  runs.forEach((r, i) => {
    const groups = [overall, get(byVersion, r.promptVersion ?? 'sem versão'), get(byRepo, r.repo ?? 'sem repo')];
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

/** Achados que vão para a review PENDING: os rejeitados ficam de fora; sem julgamento, vão todos. */
export function keptFindingIndexes(total: number, decisions: FindingDecision[] | undefined): number[] {
  return Array.from({ length: total }, (_, i) => i).filter(i => decisions?.[i] !== 'rejected');
}
