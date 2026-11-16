import { describe, expect, it } from 'vitest';
import { limitReason, startOfLocalDay } from './limits.js';

describe('limites de execução', () => {
  it('recusa acima do limite simultâneo e do diário', () => {
    expect(limitReason({ running: 2, maxConcurrent: 2, today: 0, maxDaily: 30 })).toMatch(/simultâneas/);
    expect(limitReason({ running: 0, maxConcurrent: 2, today: 30, maxDaily: 30 })).toMatch(/diário/);
    expect(limitReason({ running: 1, maxConcurrent: 2, today: 5, maxDaily: 30 })).toBeNull();
  });

  it('início do dia no fuso do time (BRT)', () => {
    // 02:00 UTC do dia 16 = 23:00 BRT do dia 15 → dia começa 15/11 03:00 UTC
    expect(startOfLocalDay(Date.parse('2026-11-16T02:00:00Z'), -180).toISOString()).toBe('2026-11-15T03:00:00.000Z');
    expect(startOfLocalDay(Date.parse('2026-11-16T12:00:00Z'), -180).toISOString()).toBe('2026-11-16T03:00:00.000Z');
  });
});
