// Idiomas da interface: pt-BR (texto-fonte) e inglês.
// A chave de cada texto é o próprio texto em português; o dicionário em i18n-en.ts traz a versão em inglês.
// Variáveis entram como {nome}: t('{n} precisam de você', { n: 3 }).
// O teste i18n.test.ts garante que toda chave usada no código tem tradução.
import { EN } from './i18n-en';
import { readPref } from './prefs';

export type Lang = 'pt-BR' | 'en';
export const LANGS: Array<{ id: Lang; label: string }> = [
  { id: 'pt-BR', label: 'Português (Brasil)' },
  { id: 'en', label: 'English' },
];

export function detectLang(): Lang {
  try { return navigator.language.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en'; } catch { return 'pt-BR'; }
}

const isLang = (v: string): v is Lang => v === 'pt-BR' || v === 'en';

let current: Lang = (() => {
  const saved = readPref<string>('lang', '');
  return isLang(saved) ? saved : detectLang();
})();

export const getLang = (): Lang => current;

/** Troca o idioma usado por t(), locale() e pelos formatadores. Quem chama re-renderiza a tela. */
export function applyLang(lang: Lang): void {
  current = lang;
  try { document.documentElement.lang = lang; } catch { /* fora do navegador (testes) */ }
}

/** Locale para datas e números. */
export const locale = (): string => (current === 'en' ? 'en-US' : 'pt-BR');

export type Vars = Record<string, string | number>;

export function translate(lang: Lang, key: string, vars?: Vars): string {
  const text = lang === 'en' ? (EN[key] ?? key) : key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

export const t = (key: string, vars?: Vars): string => translate(current, key, vars);

/** Marca um texto como chave de tradução sem traduzir agora (listas e constantes). A tela chama t() depois. */
export const k = (key: string): string => key;

// Textos que o hook (lib/state.js, hook.js) grava em português nos arquivos de sessão.
// Ficam em português no disco; a tela traduz os prefixos conhecidos.
const AGENT_PREFIXES: Array<[RegExp, string]> = [
  [/^Pedindo permissão: /, 'Asking permission: '],
  [/^Aprovado no painel: /, 'Approved on the board: '],
  [/^Negado no painel: /, 'Denied on the board: '],
  [/^Interrompido\./, 'Interrupted.'],
  [/^Terminou com erro\./, 'Finished with an error.'],
  [/^Compactando contexto \(/, 'Compacting context ('],
  [/\bferramenta\b/, 'tool'],
];

export function agentText(text: string | null | undefined): string {
  if (!text || current !== 'en') return text ?? '';
  return AGENT_PREFIXES.reduce((s, [re, en]) => s.replace(re, en), text);
}

applyLang(current);
