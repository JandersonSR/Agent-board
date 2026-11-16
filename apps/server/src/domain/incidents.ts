// Incidentes e postmortems: avisos (ações atrasadas, postmortem pendente) e o rascunho em Markdown.
// Postmortem sem culpados: o texto fala de sistemas e decisões, não de pessoas.

type When = Date | string;

export const SEVERITIES = ['sev1', 'sev2', 'sev3', 'sev4'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const INCIDENT_STATUSES = ['open', 'mitigated', 'resolved'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const POSTMORTEM_STATUSES = ['pending', 'draft', 'done', 'not_needed'] as const;
export type PostmortemStatus = (typeof POSTMORTEM_STATUSES)[number];

export interface IncidentAction { id: string; text: string; owner?: string | undefined; due?: string | undefined; done: boolean; doneAt?: When | undefined }
export interface TimelineEntry { at: When; text: string }
export interface Postmortem {
  status: PostmortemStatus; url?: string | undefined;
  whatHappened?: string | undefined; rootCause?: string | undefined; wentWell?: string | undefined; wentWrong?: string | undefined; lessons?: string | undefined;
}
export interface Incident {
  _id?: unknown;
  title: string; severity: Severity; status: IncidentStatus;
  startedAt: When; detectedAt?: When | null | undefined; mitigatedAt?: When | null | undefined; resolvedAt?: When | null | undefined;
  impact?: string | undefined; services?: string[] | undefined;
  causeChanges?: string[] | undefined; fixChanges?: string[] | undefined;
  timeline: TimelineEntry[]; actions: IncidentAction[]; postmortem: Postmortem;
  createdAt?: When; updatedAt?: When;
}

/** Postmortem obrigatório para sev1/sev2 resolvidos. */
export const needsPostmortem = (i: Pick<Incident, 'severity' | 'status' | 'postmortem'>) =>
  (i.severity === 'sev1' || i.severity === 'sev2') && i.status === 'resolved' && (i.postmortem.status === 'pending' || i.postmortem.status === 'draft');

export interface IncidentAlerts {
  open: number;
  overdueActions: Array<{ incident: string; title: string; action: string; owner?: string | undefined; due: string }>;
  openActions: number;
  postmortemPending: Array<{ incident: string; title: string; severity: Severity }>;
  actionsDoneRate: number | null;
}

export function incidentAlerts(list: Array<Incident & { _id?: unknown }>, today: string): IncidentAlerts {
  const all = list.flatMap(i => i.actions.map(a => ({ i, a })));
  return {
    open: list.filter(i => i.status !== 'resolved').length,
    overdueActions: all.filter(({ a }) => !a.done && !!a.due && a.due < today)
      .map(({ i, a }) => ({ incident: String(i._id ?? ''), title: i.title, action: a.text, owner: a.owner, due: a.due! }))
      .sort((x, y) => x.due.localeCompare(y.due)),
    openActions: all.filter(({ a }) => !a.done).length,
    postmortemPending: list.filter(needsPostmortem).map(i => ({ incident: String(i._id ?? ''), title: i.title, severity: i.severity })),
    actionsDoneRate: all.length ? all.filter(({ a }) => a.done).length / all.length : null,
  };
}

const L = {
  'pt-BR': {
    pm: 'Postmortem', sev: 'Severidade', status: 'Status', start: 'Início', detect: 'Detecção', mitig: 'Mitigação', resolve: 'Resolução',
    dur: 'Duração', impact: 'Impacto', services: 'Serviços', summary: 'O que aconteceu', root: 'Causa raiz', cause: 'Mudanças que causaram',
    fix: 'Correções', timeline: 'Linha do tempo', well: 'O que funcionou', wrong: 'O que não funcionou', lessons: 'Aprendizados',
    actions: 'Ações', owner: 'responsável', due: 'prazo', blameless: '_Postmortem sem culpados: o foco é no sistema e nas decisões, não em pessoas._',
    st: { open: 'aberto', mitigated: 'mitigado', resolved: 'resolvido' }, empty: '_a preencher_',
  },
  en: {
    pm: 'Postmortem', sev: 'Severity', status: 'Status', start: 'Started', detect: 'Detected', mitig: 'Mitigated', resolve: 'Resolved',
    dur: 'Duration', impact: 'Impact', services: 'Services', summary: 'What happened', root: 'Root cause', cause: 'Changes that caused it',
    fix: 'Fixes', timeline: 'Timeline', well: 'What went well', wrong: 'What went wrong', lessons: 'Lessons',
    actions: 'Action items', owner: 'owner', due: 'due', blameless: '_Blameless postmortem: the focus is on the system and decisions, not people._',
    st: { open: 'open', mitigated: 'mitigated', resolved: 'resolved' }, empty: '_to be filled in_',
  },
} as const;

function fmtDur(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
}

/** Rascunho do postmortem em Markdown, pronto para colar num doc ou no repositório. */
export function postmortemMarkdown(i: Incident, lang: 'pt-BR' | 'en' = 'pt-BR', tzOffsetMin = 0): string {
  const t = L[lang];
  const at = (d: When | null | undefined) => d ? new Date(new Date(d).getTime() + tzOffsetMin * 60_000).toISOString().slice(0, 16).replace('T', ' ') : '—';
  const pm = i.postmortem;
  const block = (title: string, body?: string) => `## ${title}\n\n${body?.trim() || t.empty}`;
  const list = (xs?: string[]) => (xs?.length ? xs.map(x => `- ${x}`).join('\n') : '—');
  const end = i.resolvedAt ?? i.mitigatedAt;
  return [
    `# ${t.pm}: ${i.title}`,
    t.blameless,
    [
      `| | |`, `|---|---|`,
      `| ${t.sev} | ${i.severity.toUpperCase()} |`, `| ${t.status} | ${t.st[i.status]} |`,
      `| ${t.start} | ${at(i.startedAt)} |`, `| ${t.detect} | ${at(i.detectedAt)} |`, `| ${t.mitig} | ${at(i.mitigatedAt)} |`, `| ${t.resolve} | ${at(i.resolvedAt)} |`,
      end ? `| ${t.dur} | ${fmtDur(new Date(end).getTime() - new Date(i.startedAt).getTime())} |` : '',
      i.services?.length ? `| ${t.services} | ${i.services.join(', ')} |` : '',
    ].filter(Boolean).join('\n'),
    block(t.impact, i.impact),
    block(t.summary, pm.whatHappened),
    block(t.root, pm.rootCause),
    `## ${t.cause}\n\n${list(i.causeChanges)}\n\n## ${t.fix}\n\n${list(i.fixChanges)}`,
    `## ${t.timeline}\n\n${[...i.timeline].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()).map(e => `- **${at(e.at)}** ${e.text}`).join('\n') || t.empty}`,
    block(t.well, pm.wentWell),
    block(t.wrong, pm.wentWrong),
    block(t.lessons, pm.lessons),
    `## ${t.actions}\n\n${i.actions.map(a => `- [${a.done ? 'x' : ' '}] ${a.text}${a.owner ? ` — ${t.owner}: ${a.owner}` : ''}${a.due ? ` — ${t.due}: ${a.due}` : ''}`).join('\n') || t.empty}`,
  ].join('\n\n') + '\n';
}
