// Review de PR por agente: prompt (com a skill de review do kit), resultado estruturado e
// a montagem da review PENDING no GitHub (só com clique do Tech Lead; nunca aprova).
import { z } from 'zod';

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

const JSON_CONTRACT = `{
  "verdict": "approve" | "request_changes" | "comment",
  "readyForProd": true | false,
  "confidence": 0-100,
  "summary": "resumo curto em português",
  "risks": ["..."],
  "blockers": ["..."],
  "findings": [{ "severity": "blocker|high|medium|low|note", "path": "arquivo no PR", "line": 123, "title": "...", "body": "...", "suggestion": "código sugerido (opcional)" }]
}`;

export function buildReviewPrompt(opts: { prUrl: string; skill?: string | undefined; featContext?: string | undefined; extra?: string | undefined }): string {
  return [
    opts.skill ? `# Skill de review do time (siga o método e as severidades)\n\n${opts.skill}` : '',
    opts.featContext ? `# Contexto de features (RAG)\n\n${opts.featContext}` : '',
    `# Tarefa\n\nRevise o PR ${opts.prUrl}.`,
    `Regras desta execução (têm prioridade sobre a skill):`,
    `- Modo não interativo: não faça perguntas; decida com o que tiver e registre incertezas em "risks".`,
    `- Use apenas leitura: gh pr view, gh pr diff, gh pr checks e as ferramentas do feat-map.`,
    `- NÃO poste nada no GitHub (sem review, comentário, aprovação). O Tech Lead decide depois.`,
    `- "line" é o número da linha no arquivo NOVO (lado direito do diff) e precisa estar dentro de um trecho alterado.`,
    `- Não copie dados pessoais (CPF, dados bancários, dados de clientes) para a resposta.`,
    opts.extra ? `\nObservações do Tech Lead:\n${opts.extra}` : '',
    `\nAo terminar, responda APENAS com um bloco \`\`\`json no formato:\n${JSON_CONTRACT}`,
  ].filter(Boolean).join('\n\n');
}

/** Extrai o último bloco JSON da resposta e valida. */
export function parseReviewResult(text: string): { ok: true; value: ReviewResultT } | { ok: false; error: string } {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1]!);
  const candidates = blocks.length ? blocks.reverse() : [text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)];
  for (const c of candidates) {
    try {
      const parsed = ReviewResult.safeParse(JSON.parse(c));
      if (parsed.success) return { ok: true, value: parsed.data };
    } catch { /* tenta o próximo */ }
  }
  return { ok: false, error: 'o agente não devolveu o JSON esperado' };
}

// ---------- Review PENDING ----------

/** Linhas do arquivo novo (lado direito) presentes nos trechos do patch: onde o GitHub aceita comentário. */
export function commentableLines(patch: string | undefined): Set<number> {
  const out = new Set<number>();
  if (!patch) return out;
  let line = 0;
  for (const l of patch.split('\n')) {
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { line = Number(h[1]); continue; }
    if (!line) continue;
    if (l.startsWith('-')) continue;           // linha removida: não existe no arquivo novo
    if (l.startsWith('\\')) continue;          // "\ No newline at end of file"
    out.add(line);                              // adicionada (+) ou contexto ( )
    line++;
  }
  return out;
}

const SEV_LABEL: Record<z.infer<typeof Severity>, string> = { blocker: '🔴 blocker', high: '🟠 high', medium: '🟡 medium', low: '🔵 low', note: '⚪ note' };

export interface PendingReview { body: string; comments: Array<{ path: string; line: number; side: 'RIGHT'; body: string }>; unanchored: number }

/** Monta a review PENDING: achados com linha válida viram comentário na linha; os demais vão no corpo. */
export function buildPendingReview(result: ReviewResultT, files: Array<{ filename: string; patch?: string | undefined }>): PendingReview {
  const lines = new Map(files.map(f => [f.filename, commentableLines(f.patch)]));
  const comments: PendingReview['comments'] = [];
  const loose: string[] = [];
  for (const f of result.findings) {
    const text = `**${SEV_LABEL[f.severity]} — ${f.title}**\n\n${f.body}${f.suggestion ? `\n\n\`\`\`suggestion\n${f.suggestion}\n\`\`\`` : ''}`;
    if (f.path && f.line && lines.get(f.path)?.has(f.line)) comments.push({ path: f.path, line: f.line, side: 'RIGHT', body: text });
    else loose.push(`- ${SEV_LABEL[f.severity]} ${f.path ? `\`${f.path}${f.line ? `:${f.line}` : ''}\` ` : ''}— **${f.title}**: ${f.body}`);
  }
  const body = [
    `**Pré-review automática (agente)** — confiança ${result.confidence}% · pronto para produção: ${result.readyForProd ? 'SIM' : 'NÃO'}`,
    result.summary,
    result.blockers.length ? `**Bloqueadores**\n${result.blockers.map(b => `- ${b}`).join('\n')}` : '',
    result.risks.length ? `**Riscos**\n${result.risks.map(r => `- ${r}`).join('\n')}` : '',
    loose.length ? `**Outros achados**\n${loose.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  return { body, comments, unanchored: loose.length };
}
