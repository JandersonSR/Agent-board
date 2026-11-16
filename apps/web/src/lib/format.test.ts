import { describe, expect, it } from 'vitest';
import { ago, dur, editorLink, fmtCost, fmtTok, plural } from './format';

describe('format', () => {
  it('ago', () => {
    const now = 1_000_000_000;
    expect(ago(now, now)).toBe('agora');
    expect(ago(now - 30_000, now)).toBe('30 s');
    expect(ago(now - 12 * 60_000, now)).toBe('12 min');
    expect(ago(now - 3 * 3_600_000, now)).toBe('3 h');
    expect(ago(now - 2 * 86_400_000, now)).toBe('2 d');
  });

  it('dur', () => {
    expect(dur(40_000)).toBe('40 s');
    expect(dur(12 * 60_000)).toBe('12 min');
    expect(dur(65 * 60_000)).toBe('1 h 05 min');
    expect(dur(120 * 60_000)).toBe('2 h');
    expect(dur(undefined)).toBe('0 s');
  });

  it('tokens e custo', () => {
    expect(fmtTok(0)).toBe('0');
    expect(fmtTok(950)).toBe('950');
    expect(fmtTok(12_400)).toBe('12k');
    expect(fmtTok(1_250_000)).toBe('1,3M');
    expect(fmtCost(1.5)).toBe('US$ 1,50');
    expect(fmtCost(42.4)).toBe('US$ 42');
  });

  it('plural', () => {
    expect(plural(1, 'sessão', 'sessões')).toBe('1 sessão');
    expect(plural(3, 'sessão', 'sessões')).toBe('3 sessões');
  });

  it('editorLink (Windows e POSIX)', () => {
    expect(editorLink('cursor', 'C:\\r\\app', 'src/a#b.ts')).toBe('cursor://file/C:/r/app/src/a%23b.ts');
    expect(editorLink('vscode', '/home/x/app/', 'b.ts')).toBe('vscode://file//home/x/app/b.ts');
  });
});
