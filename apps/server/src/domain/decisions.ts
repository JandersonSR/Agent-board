// The team's decision log: design docs, RFCs and ADRs, with a decide-by date.
// ADRs from local clones are imported by reading only the title, status and date.

export const DECISION_KINDS = ['adr', 'design_doc', 'rfc'] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];
export const DECISION_STATUSES = ['proposed', 'discussing', 'decided', 'rejected', 'superseded'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export const OPEN_DECISION: readonly DecisionStatus[] = ['proposed', 'discussing'];

export interface Decision {
  _id?: unknown;
  title: string; kind: DecisionKind; status: DecisionStatus;
  owner?: string | undefined; deciders?: string[] | undefined;
  url?: string | undefined; repo?: string | undefined; path?: string | undefined;
  context?: string | undefined; decision?: string | undefined;
  decideBy?: string | undefined; decidedAt?: string | undefined; date?: string | undefined;
  source: 'manual' | 'repo';
  createdAt: Date | string; updatedAt: Date | string;
}

const STATUS_WORDS: Array<[RegExp, DecisionStatus]> = [
  [/substitu|superseded|deprecated|depreciad|obsolet/i, 'superseded'],
  [/rejeitad|rejected|recusad|declined/i, 'rejected'],
  [/aceit|accepted|aprovad|approved|decidid|decided|adotad|adopted/i, 'decided'],
  [/discuss|em revis|in review|review/i, 'discussing'],
  [/propost|proposed|rascunho|draft/i, 'proposed'],
];

export function normalizeStatus(word: string | undefined): DecisionStatus | undefined {
  if (!word) return undefined;
  return STATUS_WORDS.find(([re]) => re.test(word))?.[1];
}

export interface ParsedAdr { title: string; status: DecisionStatus; date?: string | undefined }

/**
 * Reads the title (first "# "), status and date of a Markdown ADR.
 * Accepts "Status: aceito", "- **Status:** accepted" and a "## Status" section with the word on the next line.
 */
export function parseAdr(text: string, fileName: string): ParsedAdr {
  const lines = text.split(/\r?\n/).slice(0, 80);
  const heading = lines.find(l => /^#\s+\S/.test(l));
  const title = (heading?.replace(/^#\s+/, '') ?? fileName.replace(/\.md$/i, '').replace(/[-_]+/g, ' ')).trim().slice(0, 300);
  const field = (name: RegExp) => {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      const inline = l.match(new RegExp(`^[\\s>*-]*\\**(?:${name.source})\\**\\s*:\\s*\\**\\s*(.+)$`, 'i'));
      if (inline) return inline[1]!.replace(/\*+/g, '').trim();
      if (new RegExp(`^#{2,3}\\s+(?:${name.source})\\s*$`, 'i').test(l)) {
        const next = lines.slice(i + 1).find(x => x.trim());
        if (next) return next.replace(/[*_]/g, '').trim();
      }
    }
    return undefined;
  };
  const date = field(/data|date/)?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  return { title, status: normalizeStatus(field(/status|estado/)) ?? 'proposed', ...(date ? { date } : {}) };
}

export interface DecisionAlerts { open: number; overdue: number; stale: number; dueSoon: number }

/** Overdue (deadline passed), stalled (open for more than `staleDays` without a deadline) and due in the next 7 days. */
export function decisionAlerts(list: Decision[], today: string, staleDays = 21): DecisionAlerts {
  const open = list.filter(d => OPEN_DECISION.includes(d.status));
  const in7 = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const staleBefore = Date.parse(`${today}T00:00:00Z`) - staleDays * 86_400_000;
  return {
    open: open.length,
    overdue: open.filter(d => d.decideBy && d.decideBy < today).length,
    dueSoon: open.filter(d => d.decideBy && d.decideBy >= today && d.decideBy <= in7).length,
    stale: open.filter(d => !d.decideBy && new Date(d.createdAt).getTime() < staleBefore).length,
  };
}
