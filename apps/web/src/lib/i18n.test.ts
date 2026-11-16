// Garante que todo texto da tela tem versão em inglês, com as mesmas variáveis {x}.
// Lê o código-fonte e coleta as chaves usadas em t('…'), k('…') e plural(n, '…', '…').
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN } from './i18n-en';
import { applyLang, t, translate } from './i18n';

const SRC = path.resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'ui' ? [] : sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !e.name.endsWith('.test.ts') && !e.name.startsWith('i18n') ? [p] : [];
  });
}

/** Primeiro argumento de uma chamada, a partir do índice logo após o "(". */
function firstArg(src: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i]!;
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { if (depth === 0) return src.slice(start, i); depth--; }
    else if (c === ',' && depth === 0) return src.slice(start, i);
  }
  return '';
}

// Literais comparados (x === 'allow' ? …) são condições, não textos da tela.
const literals = (s: string): string[] => [...s.matchAll(/'((?:[^'\\]|\\.)*)'/g)]
  .filter(m => !/[!=]==\s*$/.test(s.slice(0, m.index)))
  .map(m => m[1]!.replace(/\\(.)/g, '$1'))
  .filter(Boolean);

function usedKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const file of sourceFiles(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(SRC, file);
    for (const m of src.matchAll(/\b(t|k)\(/g)) {
      for (const key of literals(firstArg(src, m.index! + m[0].length))) keys.set(key, rel);
    }
    for (const m of src.matchAll(/\bplural\([^,]+,\s*'([^']*)',\s*'([^']*)'\)/g)) {
      keys.set(m[1]!, rel);
      keys.set(m[2]!, rel);
    }
  }
  return keys;
}

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe('i18n', () => {
  const keys = usedKeys();

  it('encontra as chaves no código', () => {
    expect(keys.size).toBeGreaterThan(200);
  });

  it('toda chave usada tem tradução em inglês', () => {
    const missing = [...keys].filter(([k]) => !(k in EN)).map(([k, file]) => `${file}: ${k}`);
    expect(missing).toEqual([]);
  });

  it('as traduções mantêm as mesmas variáveis', () => {
    const wrong = Object.entries(EN).filter(([pt, en]) => vars(pt).join() !== vars(en).join()).map(([pt]) => pt);
    expect(wrong).toEqual([]);
  });

  it('troca de idioma e interpola', () => {
    applyLang('en');
    expect(t('{n} rodando', { n: 2 })).toBe(EN['{n} rodando']!.replace('{n}', '2'));
    applyLang('pt-BR');
    expect(t('{n} rodando', { n: 2 })).toBe('2 rodando');
    expect(translate('en', 'texto sem tradução')).toBe('texto sem tradução');
  });
});
