import { useEffect, useRef } from 'react';

export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/**
 * Atalhos globais. Chaves: "mod+k" (Ctrl/⌘), "?", "g h" (sequência), "r".
 * Ignorados enquanto se digita num campo (exceto combinações com mod).
 */
export function useHotkeys(map: HotkeyMap): void {
  const ref = useRef(map);
  ref.current = map;
  const pending = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod) {
        const h = ref.current[`mod+${key}`];
        if (h) { e.preventDefault(); h(e); }
        return;
      }
      if (e.altKey || isTyping(e.target)) return;

      const prev = pending.current;
      if (prev && Date.now() - prev.at < 900) {
        const seq = ref.current[`${prev.key} ${key}`];
        pending.current = null;
        if (seq) { e.preventDefault(); seq(e); return; }
      }
      if (Object.keys(ref.current).some(k => k.startsWith(`${key} `))) {
        pending.current = { key, at: Date.now() };
        return;
      }
      const h = ref.current[e.key] ?? ref.current[key];
      if (h) { e.preventDefault(); h(e); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
