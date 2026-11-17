import { describe, expect, it } from 'vitest';
import { limitReason, startOfLocalDay } from './limits.js';

describe('run limits', () => {
  it('refuses above the concurrent and daily limits', () => {
    expect(limitReason({ running: 2, maxConcurrent: 2, today: 0, maxDaily: 30 })).toMatch(/concurrent/);
    expect(limitReason({ running: 0, maxConcurrent: 2, today: 30, maxDaily: 30 })).toMatch(/daily limit/);
    expect(limitReason({ running: 1, maxConcurrent: 2, today: 5, maxDaily: 30 })).toBeNull();
  });

  it('start of the day in the team time zone (BRT)', () => {
    // 02:00 UTC on the 16th = 23:00 BRT on the 15th → the day starts on 11/15 at 03:00 UTC
    expect(startOfLocalDay(Date.parse('2026-11-16T02:00:00Z'), -180).toISOString()).toBe('2026-11-15T03:00:00.000Z');
    expect(startOfLocalDay(Date.parse('2026-11-16T12:00:00Z'), -180).toISOString()).toBe('2026-11-16T03:00:00.000Z');
  });
});
