// Limites de custo: execuções simultâneas e por dia (fuso do time).

export interface LimitState { running: number; maxConcurrent: number; today: number; maxDaily: number }

export function startOfLocalDay(now: number, tzOffsetMin: number): Date {
  const local = new Date(now + tzOffsetMin * 60_000);
  const startLocalUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(startLocalUtc - tzOffsetMin * 60_000);
}

/** Motivo para recusar uma nova execução, ou null se pode rodar. */
export function limitReason(s: LimitState): string | null {
  if (s.running >= s.maxConcurrent) return `limite de ${s.maxConcurrent} execuções simultâneas atingido (MAX_CONCURRENT_SESSIONS)`;
  if (s.today >= s.maxDaily) return `limite diário de ${s.maxDaily} execuções atingido (MAX_DAILY_RUNS)`;
  return null;
}
