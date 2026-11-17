// Cost limits: concurrent runs and runs per day (team time zone).

export interface LimitState { running: number; maxConcurrent: number; today: number; maxDaily: number }

export function startOfLocalDay(now: number, tzOffsetMin: number): Date {
  const local = new Date(now + tzOffsetMin * 60_000);
  const startLocalUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(startLocalUtc - tzOffsetMin * 60_000);
}

/** Reason to refuse a new run, or null if it can run. */
export function limitReason(s: LimitState): string | null {
  if (s.running >= s.maxConcurrent) return `limit of ${s.maxConcurrent} concurrent runs reached (MAX_CONCURRENT_SESSIONS)`;
  if (s.today >= s.maxDaily) return `daily limit of ${s.maxDaily} runs reached (MAX_DAILY_RUNS)`;
  return null;
}
