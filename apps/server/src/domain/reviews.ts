// Pending reviews: PR size and age in business days, oldest first.
import { businessDays } from './time.js';

export type PrSize = 'XS' | 'S' | 'M' | 'L' | 'XL';

/** Bands by changed lines (additions + deletions). 400+ is the "large PR" threshold of the warnings. */
export function prSize(additions: number, deletions: number): PrSize {
  const n = additions + deletions;
  if (n < 10) return 'XS';
  if (n < 100) return 'S';
  if (n < 400) return 'M';
  if (n < 1000) return 'L';
  return 'XL';
}

export interface ReviewInput {
  url: string;
  createdAt: string;
  /** When the review was requested from me (if known). Otherwise, the PR creation. */
  requestedAt?: string | undefined;
  additions: number;
  deletions: number;
}

export interface ReviewDerived { size: PrSize; lines: number; waitingSince: string; waitingBusinessDays: number }

export function deriveReview<T extends ReviewInput>(pr: T, now = Date.now(), holidays?: ReadonlySet<string>): T & ReviewDerived {
  const waitingSince = pr.requestedAt ?? pr.createdAt;
  return {
    ...pr,
    size: prSize(pr.additions, pr.deletions),
    lines: pr.additions + pr.deletions,
    waitingSince,
    waitingBusinessDays: Math.round(businessDays(Date.parse(waitingSince), now, holidays) * 10) / 10,
  };
}

export function sortReviews<T extends ReviewDerived>(list: T[]): T[] {
  return [...list].sort((a, b) => Date.parse(a.waitingSince) - Date.parse(b.waitingSince));
}
