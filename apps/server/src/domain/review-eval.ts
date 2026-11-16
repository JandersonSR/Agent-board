// Conjunto fixo de avaliação da review por IA: PRs com problemas conhecidos.
// A precisão (ADR 0012) mede o que a IA apontou à toa; aqui medimos o que ela deixou passar (recall).

export interface ExpectedFinding { id: string; path?: string | undefined; line?: number | undefined; keywords: string[]; note?: string | undefined }
export interface EvalCase { _id?: unknown; name: string; prUrl: string; expected: ExpectedFinding[]; createdAt?: Date | string }
export interface FoundFinding { path?: string | null | undefined; line?: number | null | undefined; title: string; body: string }

export const LINE_TOLERANCE = 10;

const normPath = (p: string) => p.trim().replace(/^\.?\//, '').toLowerCase();

/**
 * Um achado cobre o esperado quando o arquivo bate (se o esperado tiver arquivo) e
 * aparece uma das palavras-chave OU a linha fica a até 10 linhas da esperada.
 * Sem palavras-chave e sem linha, basta o arquivo.
 */
export function covers(e: ExpectedFinding, f: FoundFinding): boolean {
  if (e.path) {
    if (!f.path) return false;
    const a = normPath(e.path); const b = normPath(f.path);
    if (a !== b && !b.endsWith(`/${a}`) && !a.endsWith(`/${b}`)) return false;
  }
  const text = `${f.title}\n${f.body}`.toLowerCase();
  const kw = e.keywords.map(k => k.trim().toLowerCase()).filter(Boolean);
  const kwOk = kw.some(k => text.includes(k));
  const lineOk = e.line != null && f.line != null && Math.abs(e.line - f.line) <= LINE_TOLERANCE;
  if (!kw.length && e.line == null) return !!e.path || false;
  return kwOk || lineOk;
}

export interface CaseScore { expected: number; found: number; missed: string[]; extra: number }

export function scoreCase(expected: ExpectedFinding[], findings: FoundFinding[]): CaseScore {
  const used = new Set<number>();
  const missed: string[] = [];
  for (const e of expected) {
    const i = findings.findIndex((f, idx) => !used.has(idx) && covers(e, f));
    if (i >= 0) used.add(i); else missed.push(e.id);
  }
  return { expected: expected.length, found: expected.length - missed.length, missed, extra: findings.length - used.size };
}

export interface EvalRunLite { caseId: string; promptVersion?: string | undefined; startedAt: Date | string; status: string; findings?: FoundFinding[] | undefined; costUsd?: number | undefined }

export interface VersionRecall {
  version: string; cases: number; expected: number; found: number; recall: number | null; extraPerCase: number | null; costUsd: number;
  perCase: Array<{ caseId: string; found: number; expected: number; missed: string[]; extra: number }>;
}

/** Recall por versão do prompt, usando a execução concluída mais recente de cada caso nessa versão. */
export function recallByVersion(cases: EvalCase[], runs: EvalRunLite[]): VersionRecall[] {
  const byId = new Map(cases.map(c => [String(c._id), c]));
  const latest = new Map<string, EvalRunLite>();
  for (const r of runs) {
    if (r.status !== 'done' || !byId.has(r.caseId)) continue;
    const k = `${r.promptVersion ?? '?'}\u0000${r.caseId}`;
    const prev = latest.get(k);
    if (!prev || new Date(r.startedAt) > new Date(prev.startedAt)) latest.set(k, r);
  }
  const versions = new Map<string, VersionRecall>();
  for (const [k, r] of latest) {
    const version = k.split('\u0000')[0]!;
    const c = byId.get(r.caseId)!;
    const s = scoreCase(c.expected, r.findings ?? []);
    const v = versions.get(version) ?? { version, cases: 0, expected: 0, found: 0, recall: null, extraPerCase: null, costUsd: 0, perCase: [] };
    v.cases++; v.expected += s.expected; v.found += s.found; v.costUsd += r.costUsd ?? 0;
    v.perCase.push({ caseId: r.caseId, ...s });
    versions.set(version, v);
  }
  return [...versions.values()].map(v => ({
    ...v, recall: v.expected ? v.found / v.expected : null,
    extraPerCase: v.cases ? v.perCase.reduce((a, p) => a + p.extra, 0) / v.cases : null,
  })).sort((a, b) => b.cases - a.cases || a.version.localeCompare(b.version));
}
