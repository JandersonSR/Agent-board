// Interface languages: English (source text) and Portuguese (Brazil).
// Each text's key is the English text itself; i18n-pt.ts holds the Portuguese version.
// A "|context" suffix separates keys that read the same in English: t('Open|decisions') shows "Open".
// Variables go in as {name}: t('{n} need you', { n: 3 }).
// i18n.test.ts makes sure every key used in the code has a Portuguese translation.
import { PT, SERVER_PT } from './i18n-pt';
import { readPref } from './prefs';

export type Lang = 'pt-BR' | 'en';
export const LANGS: Array<{ id: Lang; label: string }> = [
  { id: 'pt-BR', label: 'Português (Brasil)' },
  { id: 'en', label: 'English' },
];

export function detectLang(): Lang {
  try { return navigator.language.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en'; } catch { return 'en'; }
}

const isLang = (v: string): v is Lang => v === 'pt-BR' || v === 'en';

let current: Lang = (() => {
  const saved = readPref<string>('lang', '');
  return isLang(saved) ? saved : detectLang();
})();

export const getLang = (): Lang => current;

/** Switches the language used by t(), locale() and the formatters. The caller re-renders the screen. */
export function applyLang(lang: Lang): void {
  current = lang;
  try { document.documentElement.lang = lang; } catch { /* outside the browser (tests) */ }
}

/** Locale for dates and numbers. */
export const locale = (): string => (current === 'en' ? 'en-US' : 'pt-BR');

export type Vars = Record<string, string | number>;

/** The English text of a key, without its "|context" suffix. */
export const plainKey = (key: string): string => {
  const i = key.indexOf('|');
  return i < 0 ? key : key.slice(0, i);
};

export function translate(lang: Lang, key: string, vars?: Vars): string {
  const text = lang === 'pt-BR' ? (PT[key] ?? plainKey(key)) : plainKey(key);
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

export const t = (key: string, vars?: Vars): string => translate(current, key, vars);

/** A message that came from the server (English): shown in Portuguese when there is a fixed translation for it. */
export const serverText = (msg: string): string => (current === 'pt-BR' ? SERVER_PT[msg] ?? msg : msg);

/** Marks a text as a translation key without translating it now (lists and constants). The screen calls t() later. */
export const k = (key: string): string => key;

// Texts the hook (lib/state.js, hook.js) writes into session files. New files are in English;
// files written by older versions are in Portuguese. The screen shows each one in the current language.
const AGENT_TEXTS: Array<[en: string, pt: string]> = [
  ['Asking permission: ', 'Pedindo permissão: '],
  ['Approved on the board: ', 'Aprovado no painel: '],
  ['Denied on the board: ', 'Negado no painel: '],
  ['Interrupted.', 'Interrompido.'],
  ['Finished with an error.', 'Terminou com erro.'],
  ['Compacting context (', 'Compactando contexto ('],
];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function agentText(text: string | null | undefined): string {
  if (!text) return '';
  return AGENT_TEXTS.reduce((s, [en, pt]) => {
    const [from, to] = current === 'en' ? [pt, en] : [en, pt];
    return s.replace(new RegExp(`^${escapeRe(from)}`), to);
  }, current === 'en' ? text.replace(/\bferramenta\b/, 'tool') : text.replace(/\btool\b/, 'ferramenta'));
}

applyLang(current);
