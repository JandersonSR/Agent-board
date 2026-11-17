import { describe, expect, it } from 'vitest';
import { covers, recallByVersion, scoreCase, type EvalCase } from './review-eval.js';

const f = (path: string | null, line: number | null, title: string, body = '') => ({ path, line, title, body });

describe('covers', () => {
  it('file + keyword or a nearby line', () => {
    const e = { id: 'e1', path: 'src/fee.ts', line: 40, keywords: ['arredond'] };
    expect(covers(e, f('src/fee.ts', 200, 'Arredondamento errado'))).toBe(true);
    expect(covers(e, f('./src/fee.ts', 45, 'Outro assunto'))).toBe(true);
    expect(covers(e, f('src/fee.ts', 80, 'Outro assunto'))).toBe(false);
    expect(covers(e, f('src/other.ts', 40, 'Arredondamento'))).toBe(false);
    expect(covers(e, f(null, null, 'Arredondamento'))).toBe(false);
  });
  it('no file: keywords only', () => {
    expect(covers({ id: 'e', keywords: ['sql injection'] }, f(null, null, 'Risco', 'Possível SQL injection no filtro'))).toBe(true);
  });
});

describe('scoreCase and recall', () => {
  it('each finding covers only one expected item', () => {
    const s = scoreCase([{ id: 'a', path: 'x.ts', keywords: ['null'] }, { id: 'b', path: 'x.ts', keywords: ['null'] }], [f('x.ts', 1, 'null check')]);
    expect(s).toEqual({ expected: 2, found: 1, missed: ['b'], extra: 0 });
  });

  it('uses the most recent finished run per version', () => {
    const cases: EvalCase[] = [
      { _id: 'c1', name: 'c1', prUrl: 'u', expected: [{ id: 'a', keywords: ['iof'] }] },
      { _id: 'c2', name: 'c2', prUrl: 'u', expected: [{ id: 'b', keywords: ['índice'] }, { id: 'c', keywords: ['timeout'] }] },
    ];
    const r = recallByVersion(cases, [
      { caseId: 'c1', promptVersion: 'v1', startedAt: '2026-11-01', status: 'done', findings: [], costUsd: 0.1 },
      { caseId: 'c1', promptVersion: 'v1', startedAt: '2026-11-02', status: 'done', findings: [f(null, null, 'IOF errado')], costUsd: 0.1 },
      { caseId: 'c2', promptVersion: 'v1', startedAt: '2026-11-02', status: 'done', findings: [f(null, null, 'falta índice'), f(null, null, 'estilo')], costUsd: 0.2 },
      { caseId: 'c2', promptVersion: 'v2', startedAt: '2026-11-03', status: 'failed' },
      { caseId: 'zz', promptVersion: 'v1', startedAt: '2026-11-03', status: 'done', findings: [] },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ version: 'v1', cases: 2, expected: 3, found: 2, extraPerCase: 0.5 });
    expect(r[0]!.recall).toBeCloseTo(2 / 3);
    expect(r[0]!.costUsd).toBeCloseTo(0.3);
  });
});
