import { describe, expect, it } from 'vitest';
import { deployDateFrom, parseLooseDate } from './deploy-date.js';

const now = new Date('2026-11-16T12:00:00Z');

describe('data de deploy do Project', () => {
  it('prefere campo de data cujo nome casa', () => {
    expect(deployDateFrom([
      { field: 'Start date', date: '2026-11-01' },
      { field: 'Deploy PROD', date: '2026-11-20' },
    ], /deploy/i, now)).toBe('2026-11-20');
  });

  it('usa texto/seleção com data quando não há campo de data', () => {
    expect(deployDateFrom([{ field: 'Deploy HML/PROD', text: 'PROD 25/11' }], /deploy/i, now)).toBe('2026-11-25');
  });

  it('ignora campos que não casam e textos sem data', () => {
    expect(deployDateFrom([{ field: 'Status', text: '20/11' }, { field: 'Deploy', text: 'Aguardando' }], /deploy/i, now)).toBeUndefined();
  });
});

describe('parseLooseDate', () => {
  it('formatos aceitos', () => {
    expect(parseLooseDate('2026-12-01', now)).toBe('2026-12-01');
    expect(parseLooseDate('20/11/2026', now)).toBe('2026-11-20');
    expect(parseLooseDate('20/11/26', now)).toBe('2026-11-20');
    expect(parseLooseDate('05/01', now)).toBe('2027-01-05'); // sem ano e muito no passado → ano que vem
  });
  it('recusa datas inválidas', () => {
    expect(parseLooseDate('32/13', now)).toBeUndefined();
    expect(parseLooseDate('sem data', now)).toBeUndefined();
  });
});
