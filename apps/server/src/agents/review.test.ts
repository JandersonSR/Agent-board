import { describe, expect, it } from 'vitest';
import { buildPendingReview, buildReviewPrompt, commentableLines, parseReviewResult, type ReviewResultT } from './review.js';

const result = (findings: ReviewResultT['findings']): ReviewResultT => ({
  verdict: 'request_changes', readyForProd: false, confidence: 70, summary: 'Resumo', risks: ['risco'], blockers: [], findings,
});

describe('review prompt', () => {
  it('includes the skill, the PR and the rules about not posting and not asking', () => {
    const p = buildReviewPrompt({ prUrl: 'https://github.com/o/r/pull/1', skill: 'SKILL' });
    expect(p).toContain('SKILL');
    expect(p).toContain('https://github.com/o/r/pull/1');
    expect(p).toMatch(/Do NOT post anything/);
    expect(p).toMatch(/do not ask questions/);
  });
});

describe('parseReviewResult', () => {
  it('takes the last valid json block', () => {
    const text = 'analysis...\n```json\n{"x":1}\n```\nfinal:\n```json\n' + JSON.stringify(result([])) + '\n```';
    const r = parseReviewResult(text);
    expect(r.ok && r.value.verdict).toBe('request_changes');
  });
  it('clear error when there is no valid JSON', () => {
    expect(parseReviewResult('sem json')).toEqual({ ok: false, error: 'the agent did not return the expected JSON' });
  });
});

describe('commentable lines of the patch', () => {
  it('counts added and context lines, ignores removed ones', () => {
    const patch = '@@ -10,3 +10,4 @@\n contexto\n-removida\n+nova1\n+nova2\n contexto2';
    expect([...commentableLines(patch)]).toEqual([10, 11, 12, 13]);
  });
  it('several hunks', () => {
    const patch = '@@ -1,1 +1,1 @@\n-a\n+b\n@@ -50,0 +51,2 @@\n+c\n+d';
    expect([...commentableLines(patch)]).toEqual([1, 51, 52]);
  });
});

describe('review PENDING', () => {
  const files = [{ filename: 'src/a.ts', patch: '@@ -1,1 +1,2 @@\n linha\n+nova' }];
  it('anchors findings to diff lines and sends the rest to the body', () => {
    const r = buildPendingReview(result([
      { severity: 'high', path: 'src/a.ts', line: 2, title: 'Null check', body: 'may be null' },
      { severity: 'low', path: 'src/a.ts', line: 99, title: 'Fora do diff', body: 'x' },
      { severity: 'note', title: 'Geral', body: 'y' },
    ]), files);
    expect(r.comments).toEqual([{ path: 'src/a.ts', line: 2, side: 'RIGHT', body: expect.stringContaining('Null check') }]);
    expect(r.unanchored).toBe(2);
    expect(r.body).toContain('Fora do diff');
    expect(r.body).toContain('ready for production: NO');
  });
  it('a suggestion becomes a suggestion block', () => {
    const r = buildPendingReview(result([{ severity: 'medium', path: 'src/a.ts', line: 2, title: 't', body: 'b', suggestion: 'const x = 1;' }]), files);
    expect(r.comments[0]?.body).toContain('```suggestion\nconst x = 1;\n```');
  });
});
