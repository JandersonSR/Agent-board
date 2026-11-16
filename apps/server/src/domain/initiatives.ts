// Visão do produto: uma iniciativa (ex.: o fluxo de empréstimo) dividida em etapas com dono,
// dependências e riscos. O progresso de cada etapa vem das issues acompanhadas em PRs e deploy.

export const INITIATIVE_STATUSES = ['planned', 'active', 'paused', 'done'] as const;
export type InitiativeStatus = (typeof INITIATIVE_STATUSES)[number];
export const STAGE_STATUSES = ['not_started', 'in_progress', 'blocked', 'done'] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];
export const RISK_LEVELS = ['high', 'medium', 'low'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export interface StageRisk { text: string; level: RiskLevel; mitigation?: string | undefined }
export interface Stage {
  id: string; name: string; owners: string[]; status: StageStatus; dependsOn: string[];
  /** URLs de issues (ou "repo#123") e/ou um texto buscado no título das issues acompanhadas. */
  issues: string[]; query?: string | undefined;
  targetDate?: string | undefined; notes?: string | undefined; risks: StageRisk[];
}
export interface Initiative {
  _id?: unknown;
  name: string; goal?: string | undefined; status: InitiativeStatus; targetDate?: string | undefined;
  stages: Stage[]; createdAt: Date | string; updatedAt: Date | string;
}

export interface TrackedLite { key: string; reference?: string | undefined; title: string; status: string; deployDate?: string | undefined }

export interface StageView extends Stage {
  matched: Array<{ key: string; title: string; status: string; deployDate?: string | undefined; deployed: boolean }>;
  merged: number; deployed: number; progress: number | null;
  waitingOn: string[];     // dependências ainda não concluídas
  late: boolean;           // passou da data alvo sem concluir
  critical: boolean;       // está no caminho crítico
}
export interface InitiativeView {
  stages: StageView[]; criticalPath: string[];
  progress: number; doneStages: number; highRisks: number; blocked: number; late: number;
}

/** Ciclo nas dependências (devolve os ids do ciclo) ou undefined. */
export function findCycle(stages: Array<Pick<Stage, 'id' | 'dependsOn'>>): string[] | undefined {
  const deps = new Map(stages.map(s => [s.id, s.dependsOn]));
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string[] | undefined => {
    if (state.get(id) === 2) return undefined;
    if (state.get(id) === 1) return stack.slice(stack.indexOf(id));
    state.set(id, 1); stack.push(id);
    for (const d of deps.get(id) ?? []) if (deps.has(d)) { const c = visit(d); if (c) return c; }
    stack.pop(); state.set(id, 2);
    return undefined;
  };
  for (const s of stages) { const c = visit(s.id); if (c) return c; }
  return undefined;
}

const norm = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase();
/** "owner/repo#12", "repo#12" ou URL completa da issue. */
function refMatches(ref: string, t: TrackedLite): boolean {
  const r = norm(ref);
  const urls = [t.key, t.reference ?? ''].filter(Boolean).map(norm);
  if (urls.includes(r)) return true;
  const m = r.match(/^(?:([\w.-]+)\/)?([\w.-]+)#(\d+)$/);
  if (!m) return false;
  return urls.some(u => {
    const x = u.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)$/);
    return !!x && x[2] === m[2] && x[3] === m[3] && (!m[1] || x[1] === m[1]);
  });
}

export function computeInitiative(init: Pick<Initiative, 'stages'>, tracked: TrackedLite[], today: string): InitiativeView {
  const byId = new Map(init.stages.map(s => [s.id, s]));
  const stages = init.stages.map(s => {
    const q = s.query?.trim().toLowerCase();
    const matched = tracked.filter(t => s.issues.some(r => refMatches(r, t)) || (!!q && t.title.toLowerCase().includes(q)))
      .map(t => ({ key: t.key, title: t.title, status: t.status, deployDate: t.deployDate, deployed: t.status === 'merged' && !!t.deployDate && t.deployDate <= today }));
    const merged = matched.filter(m => m.status === 'merged').length;
    const deployed = matched.filter(m => m.deployed).length;
    const waitingOn = s.dependsOn.filter(d => byId.has(d) && byId.get(d)!.status !== 'done');
    return {
      ...s, matched, merged, deployed, progress: s.status === 'done' ? 1 : matched.length ? merged / matched.length : null,
      waitingOn, late: s.status !== 'done' && !!s.targetDate && s.targetDate < today, critical: false,
    };
  });

  // Caminho crítico: a maior cadeia de etapas não concluídas, pesada pelo trabalho que falta em cada uma.
  const view = new Map(stages.map(s => [s.id, s]));
  const remaining = (s: StageView) => (s.status === 'done' ? 0 : s.matched.length ? Math.max(1, s.matched.length - s.merged) : 1);
  const memo = new Map<string, { len: number; path: string[] }>();
  const longest = (id: string, seen: Set<string>): { len: number; path: string[] } => {
    const s = view.get(id)!;
    if (memo.has(id)) return memo.get(id)!;
    if (seen.has(id)) return { len: 0, path: [] };
    seen.add(id);
    let best = { len: 0, path: [] as string[] };
    for (const d of s.dependsOn) if (view.has(d)) { const r = longest(d, seen); if (r.len > best.len) best = r; }
    seen.delete(id);
    const own = remaining(s);
    const res = own ? { len: best.len + own, path: [...best.path, id] } : best;
    memo.set(id, res);
    return res;
  };
  let critical = { len: 0, path: [] as string[] };
  for (const s of stages) { const r = longest(s.id, new Set()); if (r.len > critical.len) critical = r; }
  for (const id of critical.path) view.get(id)!.critical = true;

  const done = stages.filter(s => s.status === 'done').length;
  return {
    stages, criticalPath: critical.path,
    progress: stages.length ? stages.reduce((a, s) => a + (s.progress ?? 0), 0) / stages.length : 0,
    doneStages: done,
    highRisks: stages.filter(s => s.status !== 'done').reduce((a, s) => a + s.risks.filter(r => r.level === 'high').length, 0),
    blocked: stages.filter(s => s.status === 'blocked' || (s.status === 'in_progress' && s.waitingOn.length > 0)).length,
    late: stages.filter(s => s.late).length,
  };
}
