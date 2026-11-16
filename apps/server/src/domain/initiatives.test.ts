import { describe, expect, it } from 'vitest';
import { computeInitiative, findCycle, type Stage } from './initiatives.js';

const st = (id: string, dependsOn: string[] = [], extra: Partial<Stage> = {}): Stage =>
  ({ id, name: id, owners: [], status: 'not_started', dependsOn, issues: [], risks: [], ...extra });

describe('findCycle', () => {
  it('acha ciclo e aceita DAG', () => {
    expect(findCycle([st('a', ['c']), st('b', ['a']), st('c', ['b'])])).toEqual(['a', 'c', 'b']);
    expect(findCycle([st('a'), st('b', ['a']), st('c', ['a', 'b'])])).toBeUndefined();
  });
});

describe('computeInitiative', () => {
  const tracked = [
    { key: 'https://github.com/acme/api/issues/1', title: '[simulação] taxa', status: 'merged', deployDate: '2026-11-10' },
    { key: 'https://github.com/acme/api/issues/2', title: '[simulação] parcelas', status: 'reviewing' },
    { key: 'https://github.com/acme/api/issues/3', title: 'Contrato PDF', status: 'merged', deployDate: '2026-11-30' },
  ];
  const v = computeInitiative({
    stages: [
      st('sim', [], { status: 'in_progress', query: '[Simulação]', risks: [{ text: 'regra de IOF', level: 'high' }] }),
      st('contrato', ['sim'], { status: 'in_progress', issues: ['api#3'], targetDate: '2026-11-01' }),
      st('pagamento', ['contrato']),
      st('cadastro', [], { status: 'done', risks: [{ text: 'x', level: 'high' }] }),
    ],
  }, tracked, '2026-11-16');

  it('progresso pelas issues (busca no título e referência curta)', () => {
    const sim = v.stages[0]!;
    expect(sim.matched).toHaveLength(2);
    expect(sim).toMatchObject({ merged: 1, deployed: 1, progress: 0.5 });
    expect(v.stages[1]!.matched[0]).toMatchObject({ deployed: false });
    expect(v.stages[3]!.progress).toBe(1);
  });

  it('dependência pendente, atraso, riscos e caminho crítico', () => {
    expect(v.stages[1]).toMatchObject({ waitingOn: ['sim'], late: true });
    expect(v).toMatchObject({ blocked: 1, late: 1, highRisks: 1, doneStages: 1 });
    expect(v.criticalPath).toEqual(['sim', 'contrato', 'pagamento']);
    expect(v.stages[3]!.critical).toBe(false);
  });
});
