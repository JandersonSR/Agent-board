import { describe, expect, it } from 'vitest';
import { buildPendingReview, buildReviewPrompt, commentableLines, parseReviewResult, type ReviewResultT } from './review.js';

const result = (findings: ReviewResultT['findings']): ReviewResultT => ({
  verdict: 'request_changes', readyForProd: false, confidence: 70, summary: 'Resumo', risks: ['risco'], blockers: [], findings,
});

describe('prompt de review', () => {
  it('inclui a skill, o PR e as regras de não postar e não perguntar', () => {
    const p = buildReviewPrompt({ prUrl: 'https://github.com/o/r/pull/1', skill: 'SKILL' });
    expect(p).toContain('SKILL');
    expect(p).toContain('https://github.com/o/r/pull/1');
    expect(p).toMatch(/NÃO poste nada/);
    expect(p).toMatch(/não faça perguntas/);
  });
});

describe('parseReviewResult', () => {
  it('pega o último bloco json válido', () => {
    const text = 'análise...\n```json\n{"x":1}\n```\nfinal:\n```json\n' + JSON.stringify(result([])) + '\n```';
    const r = parseReviewResult(text);
    expect(r.ok && r.value.verdict).toBe('request_changes');
  });
  it('erro claro quando não há JSON válido', () => {
    expect(parseReviewResult('sem json')).toEqual({ ok: false, error: 'o agente não devolveu o JSON esperado' });
  });
});

describe('linhas comentáveis do patch', () => {
  it('conta adicionadas e contexto, ignora removidas', () => {
    const patch = '@@ -10,3 +10,4 @@\n contexto\n-removida\n+nova1\n+nova2\n contexto2';
    expect([...commentableLines(patch)]).toEqual([10, 11, 12, 13]);
  });
  it('vários trechos', () => {
    const patch = '@@ -1,1 +1,1 @@\n-a\n+b\n@@ -50,0 +51,2 @@\n+c\n+d';
    expect([...commentableLines(patch)]).toEqual([1, 51, 52]);
  });
});

describe('review PENDING', () => {
  const files = [{ filename: 'src/a.ts', patch: '@@ -1,1 +1,2 @@\n linha\n+nova' }];
  it('ancora achados em linhas do diff e manda o resto para o corpo', () => {
    const r = buildPendingReview(result([
      { severity: 'high', path: 'src/a.ts', line: 2, title: 'Null check', body: 'pode ser nulo' },
      { severity: 'low', path: 'src/a.ts', line: 99, title: 'Fora do diff', body: 'x' },
      { severity: 'note', title: 'Geral', body: 'y' },
    ]), files);
    expect(r.comments).toEqual([{ path: 'src/a.ts', line: 2, side: 'RIGHT', body: expect.stringContaining('Null check') }]);
    expect(r.unanchored).toBe(2);
    expect(r.body).toContain('Fora do diff');
    expect(r.body).toContain('pronto para produção: NÃO');
  });
  it('sugestão vira bloco suggestion', () => {
    const r = buildPendingReview(result([{ severity: 'medium', path: 'src/a.ts', line: 2, title: 't', body: 'b', suggestion: 'const x = 1;' }]), files);
    expect(r.comments[0]?.body).toContain('```suggestion\nconst x = 1;\n```');
  });
});
