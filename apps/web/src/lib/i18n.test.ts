// Makes sure every interface text has a Portuguese version with the same {variables}.
// Reads the source code and collects the keys used in t('…'), k('…') and plural(n, '…', '…').
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PT } from './i18n-pt';
import { agentText, applyLang, plainKey, serverText, t, translate } from './i18n';

const SRC = path.resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'ui' ? [] : sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !e.name.endsWith('.test.ts') && !e.name.startsWith('i18n') ? [p] : [];
  });
}

/** First argument of a call, starting right after the "(". */
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

// Compared literals (x === 'allow' ? …) are conditions, not screen texts.
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

  it('finds the keys in the code', () => {
    expect(keys.size).toBeGreaterThan(200);
  });

  it('every key used has a Portuguese translation', () => {
    const missing = [...keys].filter(([key]) => !(key in PT)).map(([key, file]) => `${file}: ${key}`);
    expect(missing).toEqual([]);
  });

  it('translations keep the same variables', () => {
    const wrong = Object.entries(PT).filter(([en, pt]) => vars(en).join() !== vars(pt).join()).map(([en]) => en);
    expect(wrong).toEqual([]);
  });

  it('switches language and interpolates', () => {
    applyLang('pt-BR');
    expect(t('{n} running', { n: 2 })).toBe(PT['{n} running']!.replace('{n}', '2'));
    applyLang('en');
    expect(t('{n} running', { n: 2 })).toBe('2 running');
    expect(translate('pt-BR', 'untranslated text')).toBe('untranslated text');
  });

  it('hides the context suffix', () => {
    expect(plainKey('Open|decisions')).toBe('Open');
    expect(translate('en', 'Open|decisions')).toBe('Open');
    expect(translate('pt-BR', 'Open|decisions')).toBe(PT['Open|decisions']);
    expect(PT['Open|decisions']).not.toBe(PT['Open']);
  });

  it('shows agent texts from old and new hooks in the current language', () => {
    applyLang('pt-BR');
    expect(agentText('Asking permission: Bash')).toBe('Pedindo permissão: Bash');
    applyLang('en');
    expect(agentText('Pedindo permissão: Bash')).toBe('Asking permission: Bash');
    expect(agentText('Asking permission: Bash')).toBe('Asking permission: Bash');
  });

  it('shows fixed server messages in Portuguese and leaves the rest as they come', () => {
    applyLang('pt-BR');
    expect(serverText('invalid PR URL')).toBe('URL de PR inválida');
    expect(serverText('folder no longer exists: /x')).toBe('folder no longer exists: /x');
    applyLang('en');
    expect(serverText('invalid PR URL')).toBe('invalid PR URL');
  });
});
