// Language of the texts the deck writes on its own: agent answers (reviews, plans), what goes to GitHub
// (PENDING review body, draft PR body), alert titles and incident timelines. Set with CONTENT_LANG.
export type ContentLang = 'en' | 'pt-BR';

export const parseLang = (v: string | undefined, fallback: ContentLang = 'en'): ContentLang =>
  !v ? fallback : v.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';

/** Picks the text for the language. */
export const pick = (lang: ContentLang, en: string, pt: string): string => (lang === 'pt-BR' ? pt : en);

/** Instruction appended to every agent prompt so the human-readable fields come back in the team's language. */
export const answerLanguage = (lang: ContentLang): string =>
  `- Write every human-readable field of the answer (summaries, titles, bodies, risks, questions) in ${lang === 'pt-BR' ? 'Brazilian Portuguese (pt-BR)' : 'English'}. Keep code, paths and JSON keys as they are.`;
