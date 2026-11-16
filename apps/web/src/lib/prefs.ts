// Preferências por navegador (tema, densidade, editor). O storage pode falhar (modo privado): sempre try/catch.
import { useCallback, useState } from 'react';

const KEY = 'ab3.';

export function readPref<T extends string>(name: string, fallback: T): T {
  try { return (localStorage.getItem(KEY + name) as T | null) ?? fallback; } catch { return fallback; }
}

export function writePref(name: string, value: string): void {
  try { localStorage.setItem(KEY + name, value); } catch { /* sem storage */ }
}

export function usePref<T extends string>(name: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readPref(name, fallback));
  const set = useCallback((v: T) => { writePref(name, v); setValue(v); }, [name]);
  return [value, set];
}
