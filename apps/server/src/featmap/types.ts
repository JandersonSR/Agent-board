// Shared contract of the feature RAGs: a folder with AGENTS.md and packs/_index.yaml listing
// YAML packs (id, title, summary, repos...). Schemas vary between RAGs; we normalize here.

export interface FeatPack {
  map: string;            // RAG name (from .env)
  id: string;
  title: string;
  slug?: string | undefined;
  domain?: string | undefined;  // "domain" ou "kind"
  repos: string[];        // ex.: REPO-CORE
  keywords: string[];
  summary: string;
  tokens: number;         // the pack's token estimate
  file: string;           // caminho absoluto do YAML
  updated?: string | undefined;
}

export interface FeatMapInfo {
  name: string;
  path: string;
  ok: boolean;
  error?: string | undefined;
  packs: number;
  remote?: string | undefined;     // owner/repo do origin
  lastCommit?: string | undefined; // ISO
  behind?: number | undefined;     // commits behind upstream (last known fetch)
  hasAgentsMd: boolean;
}

export interface FeatHit { pack: FeatPack; score: number; matched: string[] }
