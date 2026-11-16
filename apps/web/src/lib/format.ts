// Formatação compacta e consistente para toda a tela, no idioma escolhido.
import { getLang, locale, t } from './i18n';

/** "agora", "45 s", "12 min", "3 h", "2 d" */
export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return t('agora');
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
  if (v >= 1e6) return `${decimal((v / 1e6).toFixed(1))}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(v);
}

export function fmtCost(c: number | undefined): string {
  const v = c ?? 0;
  const n = v < 10 ? decimal(v.toFixed(2)) : String(Math.round(v));
  return getLang() === 'en' ? `$${n}` : `US$ ${n}`;
}

/** Vírgula decimal em pt-BR, ponto em inglês. */
const decimal = (s: string): string => (getLang() === 'en' ? s : s.replace('.', ','));

/** "1 PR", "3 PRs". As palavras são chaves de tradução (texto em português). */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${t(n === 1 ? one : many)}`;
}

/** Data YYYY-MM-DD no formato do idioma: 16/11 (pt-BR) ou 11/16 (en); com ano, 16/11/2026 ou 11/16/2026. */
export function fmtDay(iso: string, withYear = false): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString(locale(), withYear ? { day: '2-digit', month: '2-digit', year: 'numeric' } : { day: '2-digit', month: '2-digit' });
}

/** Link para abrir arquivo no editor (cursor://, vscode://). */
export function editorLink(editor: string, cwd: string, rel: string): string {
  const isWin = (p: string) => /^[a-z]:[\\/]/i.test(p);
  const abs = isWin(rel) || rel.startsWith('/') ? rel : cwd.replace(/[\\/]+$/, '') + (isWin(cwd) ? '\\' : '/') + rel;
  return `${editor}://file/${encodeURI(abs.replace(/\\/g, '/')).replace(/#/g, '%23')}`;
}
