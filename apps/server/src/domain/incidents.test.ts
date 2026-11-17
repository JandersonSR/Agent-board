import { describe, expect, it } from 'vitest';
import { incidentAlerts, needsPostmortem, postmortemMarkdown, type Incident } from './incidents.js';

const base: Incident = {
  title: 'Simulação fora do ar', severity: 'sev2', status: 'resolved',
  startedAt: '2026-11-10T13:00:00Z', detectedAt: '2026-11-10T13:10:00Z', resolvedAt: '2026-11-10T14:30:00Z',
  impact: 'Clientes sem simular por 90 min', causeChanges: ['https://github.com/o/r/pull/1'], fixChanges: [],
  timeline: [{ at: '2026-11-10T13:40:00Z', text: 'Rollback' }, { at: '2026-11-10T13:10:00Z', text: 'Alerta' }],
  actions: [
    { id: 'a', text: 'Teste de contrato', owner: 'Ana', due: '2026-11-12', done: false },
    { id: 'b', text: 'Alerta de latência', due: '2026-11-30', done: false },
    { id: 'c', text: 'Runbook', done: true },
  ],
  postmortem: { status: 'pending', rootCause: 'Migração sem índice' },
};

describe('incidents', () => {
  it('a resolved sev1/sev2 without a postmortem asks for one', () => {
    expect(needsPostmortem(base)).toBe(true);
    expect(needsPostmortem({ ...base, severity: 'sev3' })).toBe(false);
    expect(needsPostmortem({ ...base, postmortem: { status: 'done' } })).toBe(false);
  });

  it('warnings: late actions and completion rate', () => {
    const a = incidentAlerts([{ ...base, _id: 'x' }, { ...base, status: 'open', actions: [], postmortem: { status: 'pending' } }], '2026-11-16');
    expect(a.open).toBe(1);
    expect(a.overdueActions).toEqual([{ incident: 'x', title: base.title, action: 'Teste de contrato', owner: 'Ana', due: '2026-11-12' }]);
    expect(a.openActions).toBe(2);
    expect(a.actionsDoneRate).toBeCloseTo(1 / 3);
    expect(a.postmortemPending).toHaveLength(1);
  });

  it('markdown with a sorted timeline, duration and actions', () => {
    const md = postmortemMarkdown(base, 'pt-BR', -180);
    expect(md).toMatch(/^# Postmortem: Simulação fora do ar/);
    expect(md).toMatch(/\| Duração \| 1 h 30 min \|/);
    expect(md.indexOf('Alerta')).toBeLessThan(md.indexOf('Rollback'));
    expect(md).toMatch(/\*\*2026-11-10 10:10\*\*/); // team time
    expect(md).toMatch(/- \[ \] Teste de contrato — responsável: Ana — prazo: 2026-11-12/);
    expect(md).toMatch(/- \[x\] Runbook/);
    expect(postmortemMarkdown(base, 'en')).toMatch(/## Root cause\n\nMigração sem índice/);
  });
});
