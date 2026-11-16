// Lê os ADRs dos clones locais (só leitura, só arquivos .md em pastas conhecidas de decisões).
import fs from 'node:fs';
import path from 'node:path';
import { parseAdr, type ParsedAdr } from './decisions.js';

export const ADR_DIRS = ['docs/adr', 'docs/adrs', 'docs/decisions', 'docs/architecture/decisions', 'doc/adr', 'adr', 'adrs', 'decisions'];
const SKIP = /^(readme|index|template|_template|0000-template)\.md$/i;
const MAX_FILES = 300;
const MAX_BYTES = 200_000;

export interface ScannedAdr extends ParsedAdr { repo: string; path: string }

/** Repositórios a varrer: os de REPOS e as pastas com .git em REPOS_ROOT (no máximo 80). */
export function reposToScan(repos: Array<{ slug: string; path: string }>, reposRoot: string): Array<{ slug: string; path: string }> {
  const out = new Map<string, string>();
  for (const r of repos) if (fs.existsSync(r.path)) out.set(r.slug, r.path);
  try {
    for (const d of fs.readdirSync(reposRoot, { withFileTypes: true })) {
      if (out.size >= 80) break;
      const p = path.join(reposRoot, d.name);
      if (d.isDirectory() && !out.has(d.name) && fs.existsSync(path.join(p, '.git'))) out.set(d.name, p);
    }
  } catch { /* pasta inexistente */ }
  return [...out.entries()].map(([slug, p]) => ({ slug, path: p }));
}

export function scanRepoAdrs(slug: string, root: string): ScannedAdr[] {
  const out: ScannedAdr[] = [];
  for (const dir of ADR_DIRS) {
    const abs = path.join(root, dir);
    let files: string[];
    try { files = fs.readdirSync(abs).filter(f => f.toLowerCase().endsWith('.md') && !SKIP.test(f)).sort(); } catch { continue; }
    for (const f of files) {
      if (out.length >= MAX_FILES) return out;
      const file = path.join(abs, f);
      try {
        const st = fs.lstatSync(file);
        if (!st.isFile() || st.size > MAX_BYTES) continue; // sem links simbólicos e sem arquivos enormes
        out.push({ repo: slug, path: `${dir}/${f}`, ...parseAdr(fs.readFileSync(file, 'utf8'), f) });
      } catch { /* ilegível */ }
    }
  }
  return out;
}
