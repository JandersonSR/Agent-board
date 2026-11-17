// As quatro métricas DORA a partir do que o painel já guarda: datas de deploy das issues (painel_prs)
// e o registro de incidentes (painel_incidentes).
//
// Definições usadas (documentadas no ADR 0017):
// - Entrega = issue mergeada com data de deploy no período. Dia de deploy = data distinta.
// - Tempo de entrega (lead time) = do primeiro PR visto pelo painel até o meio-dia (hora do time) da data de deploy.
// - Mudança com falha = entrega que é correção (hotfix, rollback, revert… pela regex) ou que um incidente aponta como causa.
// - Tempo de recuperação = do início até o serviço voltar (mitigação; sem ela, a resolução) dos incidentes do período.
// - Frequência de deploy: quando há deploys reais de produção (Heroku, DigitalOcean… via Infra), eles valem;
//   senão, os dias com data de deploy das issues.
import { median, weekOf } from './team-metrics.js';

type When = Date | string;
const ts = (d: When | null | undefined) => (d ? new Date(d).getTime() : NaN);

export interface DoraPr { url?: string; title?: string; labels?: string[] | undefined; head?: string | undefined; createdAt?: When | undefined }
export interface DoraIssue {
  key: string; title: string; reference?: string | undefined;
  deployDate?: string | undefined; status: string; prs: DoraPr[];
}
export interface DoraIncident {
  severity: string; startedAt: When; detectedAt?: When | null | undefined; mitigatedAt?: When | null | undefined; resolvedAt?: When | null | undefined;
  causeChanges?: string[] | undefined;
}

export const DEFAULT_FAILURE_RE = '\\b(hot-?fix|rollback|revert|reverte|reverter|incidente|incident)\\b';

export type FailureReason = 'fix' | 'incident';
export interface DoraFailure { key: string; title: string; deployDate: string; reasons: FailureReason[] }
export interface DoraWeek { week: string; deploys: number; deployDays: number; failures: number; medianLeadMs: number | null }

export interface Dora {
  days: number;
  deploys: { items: number; days: number; itemsPerWeek: number; daysPerWeek: number; source: 'issues' | 'infra'; real?: { count: number; days: number; perWeek: number } | undefined };
  leadTime: { medianMs: number | null; p90Ms: number | null; measured: number };
  changeFailure: { failures: number; rate: number | null; fixes: number; incidents: number };
  recovery: { resolved: number; medianMs: number | null; medianDetectMs: number | null; open: number };
  weeks: DoraWeek[];
  failures: DoraFailure[];
}

function p90(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.9) - 1)]!;
}

/** Meio-dia na hora do time, em UTC (evita lead time negativo em deploy no mesmo dia). */
const deployInstant = (day: string, tzOffsetMin: number) => Date.parse(`${day}T12:00:00Z`) - tzOffsetMin * 60_000;

export function isFix(issue: DoraIssue, re: RegExp): boolean {
  const texts = [issue.title, ...issue.prs.flatMap(p => [p.title ?? '', p.head ?? '', ...(p.labels ?? [])])];
  return texts.some(t => re.test(t));
}

/** Um incidente aponta a issue (ou um PR dela) como causa. Compara URLs sem barra final e sem caixa. */
export function causedIncident(issue: DoraIssue, incidents: DoraIncident[]): boolean {
  const norm = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase();
  const mine = new Set([issue.key, issue.reference ?? '', ...issue.prs.map(p => p.url ?? '')].filter(Boolean).map(norm));
  return incidents.some(i => (i.causeChanges ?? []).some(c => mine.has(norm(c))));
}

export function computeDora(
  issues: DoraIssue[], incidents: DoraIncident[],
  opts: { days: number; now?: number; tzOffsetMin?: number; failureRe?: string; realDeploys?: Array<{ at: When; resource: string }> },
): Dora {
  const now = opts.now ?? Date.now();
  const tz = opts.tzOffsetMin ?? 0;
  const re = new RegExp(opts.failureRe || DEFAULT_FAILURE_RE, 'i');
  const since = now - opts.days * 86_400_000;
  const localDay = (t: number) => new Date(t + tz * 60_000).toISOString().slice(0, 10);
  const fromDay = localDay(since);
  const today = localDay(now);

  const seen = new Set<string>();
  const deploys = issues.filter(i => {
    if ((i.status !== 'merged' && i.status !== 'production') || !i.deployDate || i.deployDate < fromDay || i.deployDate > today || seen.has(i.key)) return false;
    seen.add(i.key);
    return true;
  });

  const rows = deploys.map(i => {
    const starts = i.prs.map(p => ts(p.createdAt)).filter(Number.isFinite);
    const lead = starts.length ? Math.max(0, deployInstant(i.deployDate!, tz) - Math.min(...starts)) : null;
    const reasons: FailureReason[] = [];
    if (isFix(i, re)) reasons.push('fix');
    if (causedIncident(i, incidents)) reasons.push('incident');
    return { issue: i, day: i.deployDate!, lead, reasons };
  });

  const leads = rows.map(r => r.lead).filter((x): x is number => x !== null);
  const failed = rows.filter(r => r.reasons.length);
  const weeks = new Map<string, typeof rows>();
  for (const r of rows) {
    const w = weekOf(Date.parse(`${r.day}T00:00:00Z`));
    weeks.set(w, [...(weeks.get(w) ?? []), r]);
  }

  const inWindow = (t: number) => Number.isFinite(t) && t >= since && t <= now;
  const restoredAt = (i: DoraIncident) => (Number.isFinite(ts(i.mitigatedAt)) ? ts(i.mitigatedAt) : ts(i.resolvedAt));
  const resolved = incidents.filter(i => inWindow(restoredAt(i)));
  const real = (opts.realDeploys ?? []).filter(d => inWindow(ts(d.at)));
  const realDays = new Set(real.map(d => localDay(ts(d.at)))).size;
  const weeksInPeriod = Math.max(1, opts.days / 7);

  return {
    days: opts.days,
    deploys: {
      items: rows.length, days: real.length ? realDays : new Set(rows.map(r => r.day)).size,
      itemsPerWeek: rows.length / weeksInPeriod, daysPerWeek: (real.length ? realDays : new Set(rows.map(r => r.day)).size) / weeksInPeriod,
      source: real.length ? 'infra' : 'issues',
      ...(real.length ? { real: { count: real.length, days: realDays, perWeek: real.length / weeksInPeriod } } : {}),
    },
    leadTime: { medianMs: median(leads), p90Ms: p90(leads), measured: leads.length },
    changeFailure: {
      failures: failed.length, rate: rows.length ? failed.length / rows.length : null,
      fixes: failed.filter(r => r.reasons.includes('fix')).length, incidents: failed.filter(r => r.reasons.includes('incident')).length,
    },
    recovery: {
      resolved: resolved.length,
      medianMs: median(resolved.map(i => restoredAt(i) - ts(i.startedAt)).filter(x => x >= 0)),
      medianDetectMs: median(resolved.map(i => ts(i.detectedAt) - ts(i.startedAt)).filter(x => Number.isFinite(x) && x >= 0)),
      open: incidents.filter(i => !i.resolvedAt).length,
    },
    weeks: [...weeks.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([week, rs]) => ({
      week, deploys: rs.length, deployDays: new Set(rs.map(r => r.day)).size,
      failures: rs.filter(r => r.reasons.length).length, medianLeadMs: median(rs.map(r => r.lead).filter((x): x is number => x !== null)),
    })),
    failures: failed.sort((a, b) => b.day.localeCompare(a.day)).slice(0, 30)
      .map(r => ({ key: r.issue.key, title: r.issue.title, deployDate: r.day, reasons: r.reasons })),
  };
}
