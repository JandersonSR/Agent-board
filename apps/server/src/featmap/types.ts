// Contrato comum dos RAGs de features: uma pasta com AGENTS.md e packs/_index.yaml que lista
// packs YAML (id, title, summary, repos...). Os esquemas variam entre RAGs; normalizamos aqui.

export interface FeatPack {
  map: string;            // nome do RAG (do .env)
  id: string;
  title: string;
  slug?: string | undefined;
  domain?: string | undefined;  // "domain" ou "kind"
  repos: string[];        // ex.: REPO-CORE
  keywords: string[];
  summary: string;
  tokens: number;         // estimativa de tokens do pack
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
  behind?: number | undefined;     // commits atrás do upstream (último fetch conhecido)
  hasAgentsMd: boolean;
}

export interface FeatHit { pack: FeatPack; score: number; matched: string[] }
