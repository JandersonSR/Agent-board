// Masking of personal data and secrets. Applied BEFORE any text goes to an
// LLM prompt, a log or a deck_* collection. When in doubt, mask (a false positive is acceptable;
// a leak is not).

export type MaskKind =
  | 'SEGREDO' | 'EMAIL' | 'CPF' | 'CNPJ' | 'CARTAO' | 'TELEFONE' | 'CEP' | 'RG'
  | 'AGENCIA' | 'CONTA' | 'VALOR' | 'EXTRA';

export interface MaskResult {
  text: string;
  counts: Partial<Record<MaskKind, number>>;
  total: number;
}

interface Rule {
  kind: MaskKind;
  re: RegExp;
  /** Replacement; receives the whole match and the groups. Default: `[KIND]`. */
  replace?: (match: string, ...groups: string[]) => string;
  /** Extra validation (e.g. Luhn). If it returns false, the match is kept. */
  accept?: (match: string) => boolean;
}

const digits = (s: string) => s.replace(/\D/g, '');

export function luhnValid(num: string): boolean {
  const d = digits(num);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

const keepLabel = (kind: MaskKind) => (_m: string, label: string) => `${label}[${kind}]`;

// Order matters: secrets and long documents before short ones.
const RULES: Rule[] = [
  // Segredos
  { kind: 'SEGREDO', re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { kind: 'SEGREDO', re: /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,40}\b/g }, // token de bot Discord
  { kind: 'SEGREDO', re: /\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi, replace: (_m, p: string) => `${p}[SEGREDO]` },
  { kind: 'SEGREDO', re: /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi, replace: (_m, p: string) => `${p}[SEGREDO]@` },
  { kind: 'SEGREDO', re: /\b((?:senha|password|passwd|secret|token|api[_-]?key)\s*[:=]\s*)\S+/gi, replace: keepLabel('SEGREDO') },

  { kind: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },

  // Documentos
  { kind: 'CNPJ', re: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g },
  { kind: 'CPF', re: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g },
  { kind: 'RG', re: /\b(RG\s*(?:n[ºo°.]?\s*)?[:\-]?\s*)[\dxX.\-]{5,14}/gi, replace: keepLabel('RG') },

  // Banking (with a label — a bare branch/account number is too ambiguous)
  { kind: 'AGENCIA', re: /\b(ag[eê]ncia\s*(?:n[ºo°.]?\s*)?[:\-]?\s*|ag\.\s*)\d{3,5}(?:-\d)?/gi, replace: keepLabel('AGENCIA') },
  { kind: 'CONTA', re: /\b((?:conta(?:\s+corrente|\s+poupan[cç]a)?|c\/c)\s*(?:n[ºo°.]?\s*)?[:\-]?\s*)\d{3,13}(?:-[\dxX])?/gi, replace: keepLabel('CONTA') },
  { kind: 'VALOR', re: /\b((?:renda|sal[aá]rio|rendimento|faturamento)\s*(?:mensal\s*)?(?:de\s*)?[:=\-]?\s*)(?:R\$\s*)?\d[\d.,]*/gi, replace: keepLabel('VALOR') },
  { kind: 'VALOR', re: /R\$\s?\d[\d.]*(?:,\d{1,2})?/g },

  // Card (only if it passes Luhn) — before the generic long numbers
  { kind: 'CARTAO', re: /\b(?:\d[ -]?){12,18}\d\b/g, accept: luhnValid },

  // Telefones BR: (11) 98765-4321, +55 11 98765 4321, 11987654321
  { kind: 'TELEFONE', re: /(?:\+?55\s?)?\(?\b\d{2}\)?[\s-]?9?\d{4}[\s-]\d{4}\b/g },

  // Bare numbers with a document's length
  { kind: 'CNPJ', re: /\b\d{14}\b/g },
  { kind: 'CPF', re: /\b\d{11}\b/g },
  { kind: 'CEP', re: /\b\d{5}-\d{3}\b/g },
];

// Spans that are never personal data and must not be broken by masking:
// Discord mentions/channels and URLs (the URL path stays; the query string is masked).
const PROTECT = /<(?:@[!&]?|#)\d{15,22}>|https?:\/\/[^\s<>()]+/g;

function compileExtra(patterns: string[]): Rule[] {
  const out: Rule[] = [];
  for (const p of patterns) {
    try { out.push({ kind: 'EXTRA', re: new RegExp(p, 'g') }); } catch { /* regex inválida no .env: ignora */ }
  }
  return out;
}

function applyRules(input: string, rules: Rule[], counts: MaskResult['counts']): string {
  let text = input;
  for (const rule of rules) {
    text = text.replace(rule.re, (match: string, ...rest: unknown[]) => {
      if (rule.accept && !rule.accept(match)) return match;
      counts[rule.kind] = (counts[rule.kind] ?? 0) + 1;
      const groups = rest.filter((g): g is string => typeof g === 'string');
      return rule.replace ? rule.replace(match, ...groups) : `[${rule.kind}]`;
    });
  }
  return text;
}

export function createMasker(extraPatterns: string[] = []) {
  const rules = [...RULES, ...compileExtra(extraPatterns)];

  return function mask(input: string | null | undefined): MaskResult {
    const counts: MaskResult['counts'] = {};
    if (!input) return { text: '', counts, total: 0 };

    const kept: string[] = [];
    const placeholder = (i: number) => `\u0000${i}\u0000`;
    const shielded = input.replace(PROTECT, (m) => {
      let safe = m;
      if (m.startsWith('http')) {
        const q = m.indexOf('?');
        if (q >= 0) safe = m.slice(0, q + 1) + applyRules(decodeSafe(m.slice(q + 1)), rules, counts);
        safe = safe.replace(/(:\/\/)[^\s:/@]+:[^\s@/]+@/, (_x, p: string) => {
          counts.SEGREDO = (counts.SEGREDO ?? 0) + 1;
          return `${p}[SEGREDO]@`;
        });
      }
      kept.push(safe);
      return placeholder(kept.length - 1);
    });

    const masked = applyRules(shielded, rules, counts)
      .replace(/\u0000(\d+)\u0000/g, (_m, i: string) => kept[Number(i)] ?? '');

    const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
    return { text: masked, counts, total };
  };
}

function decodeSafe(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Default masker (no extra patterns). Use createMasker(config.maskExtraPatterns) in the app. */
export const maskText = createMasker();
