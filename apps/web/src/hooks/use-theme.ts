import { useEffect } from 'react';
import { usePref } from '@/lib/prefs';

export type ThemePref = 'system' | 'light' | 'dark';
export type Density = 'comfortable' | 'compact';

/** Applies the theme (.dark class) and density on <html>. "system" follows the OS live. */
export function useThemeAndDensity() {
  const [theme, setTheme] = usePref<ThemePref>('theme', 'system');
  const [density, setDensity] = usePref<Density>('density', 'comfortable');

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => { document.documentElement.dataset.density = density; }, [density]);

  return { theme, setTheme, density, setDensity };
}
