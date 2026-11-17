import { describe, expect, it } from 'vitest';
import { deriveReview, prSize, sortReviews } from './reviews.js';
import { businessDays } from './time.js';

describe('PR size', () => {
  it('bands', () => {
    expect(prSize(3, 2)).toBe('XS');
    expect(prSize(60, 10)).toBe('S');
    expect(prSize(300, 50)).toBe('M');
    expect(prSize(380, 20)).toBe('L'); // 400 = grande
    expect(prSize(1500, 100)).toBe('XL');
  });
});

describe('business days', () => {
  it('does not count weekends', () => {
    const fri = Date.parse('2026-11-13T12:00:00Z');
    const mon = Date.parse('2026-11-16T12:00:00Z');
    expect(businessDays(fri, mon)).toBeCloseTo(1, 5);
  });
  it('skips holidays', () => {
    const mon = Date.parse('2026-11-16T00:00:00Z');
    const wed = Date.parse('2026-11-18T00:00:00Z');
    expect(businessDays(mon, wed, new Set(['2026-11-17']))).toBeCloseTo(1, 5);
  });
  it('an inverted range is zero', () => {
    expect(businessDays(10, 5)).toBe(0);
  });
});

describe('reviews', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  it('uses the review request date when it exists', () => {
    const r = deriveReview({ url: 'a', createdAt: '2026-11-01T00:00:00Z', requestedAt: '2026-11-13T12:00:00Z', additions: 10, deletions: 0 }, now);
    expect(r.waitingSince).toBe('2026-11-13T12:00:00Z');
    expect(r.waitingBusinessDays).toBe(1);
    expect(r.size).toBe('S');
  });
  it('sorts from oldest to newest', () => {
    const list = [
      deriveReview({ url: 'novo', createdAt: '2026-11-15T00:00:00Z', additions: 1, deletions: 0 }, now),
      deriveReview({ url: 'velho', createdAt: '2026-11-01T00:00:00Z', additions: 1, deletions: 0 }, now),
    ];
    expect(sortReviews(list).map(r => r.url)).toEqual(['velho', 'novo']);
  });
});
