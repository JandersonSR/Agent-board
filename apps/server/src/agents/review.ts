// Agent PR review: prompt (with the kit's review skill), structured result and
// building the PENDING review on GitHub (only on the Tech Lead's click; never approves).
import { z } from 'zod';
import { answerLanguage, pick, type ContentLang } from '../domain/lang.js';

export const Severity = z.enum(['blocker', 'high', 'medium', 'low', 'note']);

export const ReviewResult = z.object({
  verdict: z.enum(['approve', 'request_changes', 'comment']),
  readyForProd: z.boolean(),
  confidence: z.number().min(0).max(100),
  summary: z.string().max(4000),
  risks: z.array(z.string().max(500)).max(20).default([]),
  blockers: z.array(z.string().max(500)).max(20).default([]),
  findings: z.array(z.object({
    severity: Severity,
    path: z.string().max(400).optional(),
    line: z.number().int().positive().optional(),
    title: z.string().max(300),
    body: z.string().max(4000),
    suggestion: z.string().max(4000).optional(),
  })).max(60).default([]),
});
export type ReviewResultT = z.infer<typeof ReviewResult>;

/**
 * Prompt template version for this run. Bump it when changing buildReviewPrompt or JSON_CONTRACT:
 * quality (finding precision) is compared by version.
 */
export const REVIEW_PROMPT_VERSION = 'r2';

const JSON_CONTRACT = `{
  "verdict": "approve" | "request_changes" | "comment",
  "readyForProd": true | false,
  "confidence": 0-100,
  "summary": "short summary",
  "risks": ["..."],
  "blockers": ["..."],
  "findings": [{ "severity": "blocker|high|medium|low|note", "path": "file in the PR", "line": 123, "title": "...", "body": "...", "suggestion": "suggested code (optional)" }]
}`;

export function buildReviewPrompt(opts: { prUrl: string; skill?: string | undefined; featContext?: string | undefined; extra?: string | undefined; lang?: ContentLang | undefined }): string {
  return [
    opts.skill ? `# The team's review skill (follow its method and severities)\n\n${opts.skill}` : '',
    opts.featContext ? `# Feature context (RAG)\n\n${opts.featContext}` : '',
    `# Task\n\nReview the PR ${opts.prUrl}.`,
    `Rules for this run (they take precedence over the skill):`,
    `- Non-interactive mode: do not ask questions; decide with what you have and record uncertainties in "risks".`,
    `- Read-only: gh pr view, gh pr diff, gh pr checks and the feat-map tools.`,
    `- Do NOT post anything on GitHub (no review, comment or approval). The Tech Lead decides later.`,
    `- "line" is the line number in the NEW file (right side of the diff) and must be inside a changed hunk.`,
    `- Do not copy personal data (national IDs, bank details, customer data) into the answer.`,
    answerLanguage(opts.lang ?? 'en'),
    opts.extra ? `\nTech Lead notes:\n${opts.extra}` : '',
    `\nWhen you finish, answer ONLY with a \`\`\`json block in this format:\n${JSON_CONTRACT}`,
  ].filter(Boolean).join('\n\n');
}

/** Extracts the last valid JSON block from the agent's answer (from the end backwards). */
export function parseJsonBlock<T>(text: string, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1]!);
  const candidates = blocks.length ? blocks.reverse() : [text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)];
  for (const c of candidates) {
    try {
      const parsed = schema.safeParse(JSON.parse(c));
      if (parsed.success) return { ok: true, value: parsed.data };
    } catch { /* tenta o próximo */ }
  }
  return { ok: false, error: 'the agent did not return the expected JSON' };
}

export const parseReviewResult = (text: string) => parseJsonBlock(text, ReviewResult);

// ---------- Review PENDING ----------

/** Lines of the new file (right side) present in the patch hunks: where GitHub accepts a comment. */
export function commentableLines(patch: string | undefined): Set<number> {
  const out = new Set<number>();
  if (!patch) return out;
  let line = 0;
  for (const l of patch.split('\n')) {
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { line = Number(h[1]); continue; }
    if (!line) continue;
    if (l.startsWith('-')) continue;           // removed line: does not exist in the new file
    if (l.startsWith('\\')) continue;          // "\ No newline at end of file"
    out.add(line);                              // adicionada (+) ou contexto ( )
    line++;
  }
  return out;
}

const SEV_LABEL: Record<z.infer<typeof Severity>, string> = { blocker: '🔴 blocker', high: '🟠 high', medium: '🟡 medium', low: '🔵 low', note: '⚪ note' };

export interface PendingReview { body: string; comments: Array<{ path: string; line: number; side: 'RIGHT'; body: string }>; unanchored: number }

/** Builds the PENDING review: findings with a valid line become line comments; the rest go in the body. */
export function buildPendingReview(result: ReviewResultT, files: Array<{ filename: string; patch?: string | undefined }>, lang: ContentLang = 'en'): PendingReview {
  const L = (en: string, pt: string) => pick(lang, en, pt);
  const lines = new Map(files.map(f => [f.filename, commentableLines(f.patch)]));
  const comments: PendingReview['comments'] = [];
  const loose: string[] = [];
  for (const f of result.findings) {
    const text = `**${SEV_LABEL[f.severity]} — ${f.title}**\n\n${f.body}${f.suggestion ? `\n\n\`\`\`suggestion\n${f.suggestion}\n\`\`\`` : ''}`;
    if (f.path && f.line && lines.get(f.path)?.has(f.line)) comments.push({ path: f.path, line: f.line, side: 'RIGHT', body: text });
    else loose.push(`- ${SEV_LABEL[f.severity]} ${f.path ? `\`${f.path}${f.line ? `:${f.line}` : ''}\` ` : ''}— **${f.title}**: ${f.body}`);
  }
  const body = [
    `**${L('Automatic pre-review (agent)', 'Pré-review automática (agente)')}** — ${L('confidence', 'confiança')} ${result.confidence}% · ${L('ready for production', 'pronto para produção')}: ${result.readyForProd ? L('YES', 'SIM') : L('NO', 'NÃO')}`,
    result.summary,
    result.blockers.length ? `**${L('Blockers', 'Bloqueadores')}**\n${result.blockers.map(b => `- ${b}`).join('\n')}` : '',
    result.risks.length ? `**${L('Risks', 'Riscos')}**\n${result.risks.map(r => `- ${r}`).join('\n')}` : '',
    loose.length ? `**${L('Other findings', 'Outros achados')}**\n${loose.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  return { body, comments, unanchored: loose.length };
}
