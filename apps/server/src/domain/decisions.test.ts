import { describe, expect, it } from 'vitest';
import { decisionAlerts, normalizeStatus, parseAdr, type Decision } from './decisions.js';

describe('parseAdr', () => {
  it('this repository\'s format', () => {
    expect(parseAdr('# ADR 0004 — Mascaramento\n\n- **Status:** aceito\n- **Data:** 2026-11-01\n', '0004.md'))
      .toEqual({ title: 'ADR 0004 — Mascaramento', status: 'decided', date: '2026-11-01' });
  });
  it('Nygard format (## Status section)', () => {
    expect(parseAdr('# 2. Use Kafka\n\nDate: 2025-03-02\n\n## Status\n\nSuperseded by 5\n', '0002-use-kafka.md'))
      .toMatchObject({ title: '2. Use Kafka', status: 'superseded', date: '2025-03-02' });
  });
  it('no title and no status', () => {
    expect(parseAdr('texto solto', '0007-filas_de-pagamento.md')).toEqual({ title: '0007 filas de pagamento', status: 'proposed' });
  });
  it('status words in pt and en', () => {
    expect(normalizeStatus('Rejeitada')).toBe('rejected');
    expect(normalizeStatus('Em discussão')).toBe('discussing');
    expect(normalizeStatus('Proposed')).toBe('proposed');
    expect(normalizeStatus('xyz')).toBeUndefined();
  });
});

describe('decisionAlerts', () => {
  const d = (status: Decision['status'], decideBy?: string, createdAt = '2026-11-10'): Decision =>
    ({ title: 'x', kind: 'rfc', status, decideBy, source: 'manual', createdAt, updatedAt: createdAt });
  it('overdue, near the deadline and stalled', () => {
    expect(decisionAlerts([d('proposed', '2026-11-10'), d('discussing', '2026-11-20'), d('proposed', undefined, '2026-10-01'), d('decided', '2026-11-01')], '2026-11-16'))
      .toEqual({ open: 3, overdue: 1, dueSoon: 1, stale: 1 });
  });
});
