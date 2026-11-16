// Formatação compacta e consistente (pt-BR) para toda a tela.

/** "agora", "45 s", "12 min", "3 h", "2 d" */
export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'agora';
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

/** Duração: "40 s", "12 min", "1 h 05 min" */
export function dur(ms: number | undefined): string {
  const v = ms ?? 0;
  if (v < 60_000) return `${Math.round(v / 1000)} s`;
  const m = Math.round(v / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')} min` : `${h} h`;
}

export function fmtTok(n: number | undefined): string {
  const v = n ?? 0;
  if (!v) return '0';
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace('.', ',')}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(v);
}

export function fmtCost(c: number | undefined): string {
  const v = c ?? 0;
  return `US$ ${v < 10 ? v.toFixed(2).replace('.', ',') : Math.round(v)}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Link para abrir arquivo no editor (cursor://, vscode://). */
export function editorLink(editor: string, cwd: string, rel: string): string {
  const isWin = (p: string) => /^[a-z]:[\\/]/i.test(p);
  const abs = isWin(rel) || rel.startsWith('/') ? rel : cwd.replace(/[\\/]+$/, '') + (isWin(cwd) ? '\\' : '/') + rel;
  return `${editor}://file/${encodeURI(abs.replace(/\\/g, '/')).replace(/#/g, '%23')}`;
}
