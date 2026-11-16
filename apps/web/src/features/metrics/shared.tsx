// Peças comuns das abas de Métricas.
import { dur } from '@/lib/format';

export function Tile({ label, value, sub }: { label: string; value: string; sub?: string | undefined }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
export const durOrDash = (x: number | null) => (x === null ? '—' : dur(x));
