// Loads and caches the feature RAGs (local clones). Reloads when
// packs/_index.yaml changes (mtime). Only reads files and runs read-only git; never changes the clones.
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { Config } from '../config.js';
import { execCmd } from '../util/exec.js';
import { mapsForRepo, searchPacks } from './search.js';
import type { FeatHit, FeatMapInfo, FeatPack } from './types.js';

const IndexSchema = z.object({
  packs: z.array(z.object({ id: z.string(), path: z.string() }).passthrough()),
}).passthrough();

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === 'string' && v ? v.split(/[,|]/).map(s => s.trim()).filter(Boolean) : []);

function loadPacks(name: string, root: string): FeatPack[] {
  const index = IndexSchema.parse(parseYaml(fs.readFileSync(path.join(root, 'packs', '_index.yaml'), 'utf8')));
  const out: FeatPack[] = [];
  for (const entry of index.packs) {
    const file = path.resolve(root, entry.path);
    if (!file.startsWith(path.resolve(root))) continue; // never leave the RAG folder
    let doc: Record<string, unknown> = {};
    try { doc = (parseYaml(fs.readFileSync(file, 'utf8')) ?? {}) as Record<string, unknown>; } catch { /* pack ilegível: usa o índice */ }
    const e = entry as Record<string, unknown>;
    const summary = str(doc.summary);
    out.push({
      map: name,
      id: entry.id,
      // No title (or title = id): uses the readable slug.
      title: (() => {
        const t = str(doc.title ?? e.title);
        const slug = str(doc.slug ?? e.slug);
        return t && t !== entry.id ? t : slug ? slug.replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase()) : entry.id;
      })(),
      slug: str(doc.slug ?? e.slug) || undefined,
      domain: str(doc.domain ?? doc.kind ?? e.domain ?? e.kind) || undefined,
      repos: arr(doc.repos ?? e.repos),
      keywords: arr(doc.keywords ?? e.keywords).filter(k => /[a-z]/i.test(k) && !/[\]#|]/.test(k)),
      summary,
      tokens: Number(e.tokenBudgetHint ?? e.tokens ?? 0) || Math.ceil(summary.length / 4) + 100,
      file,
      updated: str(doc.updated ?? e.updated) || undefined,
    });
  }
  return out;
}

async function gitInfo(root: string): Promise<Pick<FeatMapInfo, 'remote' | 'lastCommit' | 'behind'>> {
  const [remote, last, behind] = await Promise.all([
    execCmd('git', ['-C', root, 'remote', 'get-url', 'origin']),
    execCmd('git', ['-C', root, 'log', '-1', '--format=%cI']),
    execCmd('git', ['-C', root, 'rev-list', '--count', 'HEAD..@{upstream}']),
  ]);
  return {
    remote: remote.ok ? remote.stdout.trim().replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '') : undefined,
    lastCommit: last.ok ? last.stdout.trim() : undefined,
    behind: behind.ok ? Number(behind.stdout.trim()) : undefined,
  };
}

export class FeatMapRegistry {
  private cache = new Map<string, { mtime: number; packs: FeatPack[]; info: FeatMapInfo }>();

  constructor(private readonly cfg: Pick<Config, 'paths' | 'featMapRoutes' | 'featContextTokens'>) {}

  get names(): string[] { return this.cfg.paths.featMaps.map(m => m.name); }

  private async load(name: string, root: string) {
    const indexFile = path.join(root, 'packs', '_index.yaml');
    let mtime = 0;
    try { mtime = fs.statSync(indexFile).mtimeMs; } catch { /* sem índice */ }
    const hit = this.cache.get(name);
    if (hit && hit.mtime === mtime && mtime) return hit;

    const base: FeatMapInfo = { name, path: root, ok: false, packs: 0, hasAgentsMd: fs.existsSync(path.join(root, 'AGENTS.md')) };
    let entry: { mtime: number; packs: FeatPack[]; info: FeatMapInfo };
    if (!fs.existsSync(root)) entry = { mtime: 0, packs: [], info: { ...base, error: 'folder does not exist (clone the repository)' } };
    else if (!mtime) entry = { mtime: 0, packs: [], info: { ...base, error: 'packs/_index.yaml not found', ...(await gitInfo(root)) } };
    else {
      try {
        const packs = loadPacks(name, root);
        entry = { mtime, packs, info: { ...base, ok: true, packs: packs.length, ...(await gitInfo(root)) } };
      } catch (e) {
        entry = { mtime: 0, packs: [], info: { ...base, error: `invalid index: ${(e as Error).message.split('\n')[0]}` } };
      }
    }
    this.cache.set(name, entry);
    return entry;
  }

  async all(): Promise<{ maps: FeatMapInfo[]; packs: FeatPack[] }> {
    const loaded = await Promise.all(this.cfg.paths.featMaps.map(m => this.load(m.name, m.path)));
    return { maps: loaded.map(l => l.info), packs: loaded.flatMap(l => l.packs) };
  }

  async search(query: string, opts: { repo?: string | undefined; limit?: number } = {}): Promise<{ maps: string[]; hits: FeatHit[] }> {
    const { packs } = await this.all();
    const maps = mapsForRepo(this.names, this.cfg.featMapRoutes, opts.repo);
    const hits = searchPacks(packs, query, { maps, repo: opts.repo, limit: opts.limit ?? 5, tokenBudget: this.cfg.featContextTokens });
    return { maps, hits };
  }

  /** Pack content for the prompt (Phase 3). */
  readPack(p: FeatPack): string {
    return fs.readFileSync(p.file, 'utf8');
  }
}
