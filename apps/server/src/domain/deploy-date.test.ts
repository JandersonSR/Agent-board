import { describe, expect, it } from 'vitest';
import { deployDateFrom, parseLooseDate } from './deploy-date.js';

const now = new Date('2026-11-16T12:00:00Z');

describe('Project deploy date', () => {
  it('prefers a date field whose name matches', () => {
    expect(deployDateFrom([
      { field: 'Start date', date: '2026-11-01' },
      { field: 'Deploy PROD', date: '2026-11-20' },
    ], /deploy/i, now)).toBe('2026-11-20');
  });

  it('uses a text/select with a date when there is no date field', () => {
    expect(deployDateFrom([{ field: 'Deploy HML/PROD', text: 'PROD 25/11' }], /deploy/i, now)).toBe('2026-11-25');
  });

  it('ignores fields that do not match and texts without a date', () => {
    expect(deployDateFrom([{ field: 'Status', text: '20/11' }, { field: 'Deploy', text: 'Aguardando' }], /deploy/i, now)).toBeUndefined();
  });
});

describe('parseLooseDate', () => {
  it('accepted formats', () => {
    expect(parseLooseDate('2026-12-01', now)).toBe('2026-12-01');
    expect(parseLooseDate('20/11/2026', now)).toBe('2026-11-20');
    expect(parseLooseDate('20/11/26', now)).toBe('2026-11-20');
    expect(parseLooseDate('05/01', now)).toBe('2027-01-05'); // no year and far in the past → next year
  });
  it('refuses invalid dates', () => {
    expect(parseLooseDate('32/13', now)).toBeUndefined();
    expect(parseLooseDate('sem data', now)).toBeUndefined();
  });
});
