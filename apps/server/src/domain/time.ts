// Tempo em dias úteis (seg–sex). Feriados podem ser passados como 'YYYY-MM-DD'.
// Usado na idade dos reviews e nos avisos (ex.: "PR esperando há mais de 1 dia útil").

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Milissegundos úteis entre `from` e `to` (fins de semana e feriados não contam). */
export function businessMs(from: number, to: number, holidays: ReadonlySet<string> = new Set()): number {
  if (to <= from) return 0;
  let total = 0;
  let cursor = from;
  while (cursor < to) {
    const d = new Date(cursor);
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const next = Math.min(dayStart + DAY, to);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(isoDay(d))) total += next - cursor;
    cursor = next;
  }
  return total;
}

export const businessDays = (from: number, to: number, holidays?: ReadonlySet<string>) => businessMs(from, to, holidays) / DAY;

/** Ajusta um timestamp para o "relógio local" do time (offset em minutos, ex.: -180 para BRT). */
export const shiftTz = (ts: number, offsetMin: number) => ts + offsetMin * 60_000;
