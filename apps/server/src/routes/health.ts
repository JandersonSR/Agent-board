// Estado de cada integração, para a tela de Configuração e os estados vazios dos blocos.
// Nunca devolve valores de segredos — só se estão presentes e funcionando.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { SKILL_ROLES, type Config } from '../config.js';
import type { FeatMapRegistry } from '../featmap/registry.js';
import type { PainelStore } from '../store/mongo.js';
import { execCmd } from '../util/exec.js';

export type CheckState = 'ok' | 'warn' | 'off' | 'error';
export interface Check { id: string; label: string; state: CheckState; detail: string; hint?: string }

/** Textos da tela de Configuração no idioma pedido pela web (?lang=en). Padrão: português. */
type Tr = (pt: string, en: string) => string;
export const trFor = (lang: unknown): Tr => (pt, en) => (lang === 'en' ? en : pt);


async function claudeCheck(tr: Tr): Promise<Check> {
  const r = await execCmd('claude', ['--version'], { timeoutMs: 15_000 });
  if (!r.ok) return { id: 'claude', label: 'Claude Code CLI', state: 'error', detail: tr('claude não encontrado no PATH', 'claude not found on PATH'), hint: tr('Instale o Claude Code e faça login (claude /login).', 'Install Claude Code and log in (claude /login).') };
  const apiKey = !!process.env.ANTHROPIC_API_KEY;
  return {
    id: 'claude', label: 'Claude Code CLI', state: 'ok',
    detail: `${r.stdout.trim()} · ${tr('autenticação', 'auth')}: ${apiKey ? tr('ANTHROPIC_API_KEY presente (será removida nas sessões)', 'ANTHROPIC_API_KEY set (removed from agent runs)') : tr('login do Claude Code', 'Claude Code login')}`,
  };
}

async function githubCheck(cfg: Config, tr: Tr): Promise<Check> {
  const base = { id: 'github', label: 'GitHub' };
  if (!cfg.github.org) return { ...base, state: 'off', detail: tr('GITHUB_ORG não definido', 'GITHUB_ORG not set'), hint: tr('Defina GITHUB_ORG no .env.', 'Set GITHUB_ORG in .env.') };
  if (cfg.github.token) return { ...base, state: 'ok', detail: `${tr('token do .env', 'token from .env')} · org ${cfg.github.org}` };
  const r = await execCmd('gh', ['auth', 'status', '--active'], { timeoutMs: 15_000 });
  return r.ok
    ? { ...base, state: 'ok', detail: `${tr('gh autenticado', 'gh authenticated')} · org ${cfg.github.org}` }
    : { ...base, state: 'error', detail: tr('gh não autenticado', 'gh not authenticated'), hint: tr('Rode: gh auth login', 'Run: gh auth login') };
}

export function discordCheck(cfg: Config, tr: Tr): Check {
  const base = { id: 'discord', label: tr('Discord (bot só leitura)', 'Discord (read-only bot)') };
  const d = cfg.discord;
  if (!d.token) return { ...base, state: 'off', detail: tr('DISCORD_BOT_TOKEN não definido', 'DISCORD_BOT_TOKEN not set'), hint: tr('Crie um bot só com View Channels + Read Message History e Message Content intent.', 'Create a bot with only View Channels + Read Message History and the Message Content intent.') };
  const missing = [!d.guildId && 'DISCORD_GUILD_ID', !d.dailyChannelId && 'DISCORD_DAILY_CHANNEL_ID', !d.myUserId && 'DISCORD_MY_USER_ID'].filter(Boolean);
  if (missing.length) return { ...base, state: 'warn', detail: `${tr('faltando', 'missing')}: ${missing.join(', ')}` };
  return { ...base, state: 'ok', detail: tr(`daily + ${d.watchChannels.length} canais observados · ${d.team.length} pessoas`, `daily + ${d.watchChannels.length} watched channels · ${d.team.length} people`) };
}

function mongoCheck(store: PainelStore, tr: Tr): Check {
  const sqlite = store.kind === 'sqlite';
  const base = { id: 'mongo', label: sqlite ? tr('Dados do painel (SQLite local)', 'Board data (local SQLite)') : tr('MongoDB (coleções painel_*)', 'MongoDB (painel_* collections)') };
  const s = store.status;
  switch (s.state) {
    case 'not_configured': return { ...base, state: 'off', detail: tr('STORAGE=none: nada é guardado', 'STORAGE=none: nothing is stored'), hint: tr('Tire STORAGE=none para usar o arquivo local, ou preencha MONGO_URI.', 'Remove STORAGE=none to use the local file, or set MONGO_URI.') };
    case 'connecting': return { ...base, state: 'warn', detail: tr('conectando…', 'connecting…') };
    case 'connected': return { ...base, state: 'ok', detail: sqlite ? `${tr('arquivo', 'file')} ${s.db}` : `${tr('banco', 'database')} ${s.db}` };
    case 'error': return { ...base, state: 'error', detail: `${tr('falha', 'failed')}: ${s.message}` };
  }
}

async function featMapCheck(registry: FeatMapRegistry, tr: Tr): Promise<Check> {
  const base = { id: 'featmap', label: tr('RAGs de features', 'Feature RAGs') };
  if (!registry.names.length) return { ...base, state: 'off', detail: tr('FEAT_MAPS não definido', 'FEAT_MAPS not set'), hint: 'Ex.: FEAT_MAPS=core=C:/reps/mapa-a;outro=C:/reps/mapa-b' };
  const { maps } = await registry.all();
  const bad = maps.filter(m => !m.ok);
  const detail = maps.map(m => m.ok ? `${m.name}: ${m.packs} packs${m.behind ? ` (${m.behind} ${tr('commits atrás', 'commits behind')})` : ''}` : `${m.name}: ${m.error}`).join(' · ');
  const state: CheckState = bad.length === maps.length ? 'error' : bad.length || maps.some(m => m.behind) ? 'warn' : 'ok';
  return { ...base, state, detail, ...(bad.length ? { hint: tr('Clone o repositório do RAG na pasta indicada em FEAT_MAPS.', 'Clone the RAG repository into the folder set in FEAT_MAPS.') } : maps.some(m => m.behind) ? { hint: tr('Rode git pull no clone do RAG para atualizar.', 'Run git pull in the RAG clone to update it.') } : {}) };
}

function skillsCheck(cfg: Config, tr: Tr): Check {
  const base = { id: 'skills', label: tr('Kit de skills (review, daily)', 'Skills kit (review, daily)') };
  const p = cfg.paths.skillsKit;
  if (!p) return { ...base, state: 'off', detail: tr('SKILLS_KIT_PATH não definido', 'SKILLS_KIT_PATH not set') };
  const roles = SKILL_ROLES.filter(r => cfg.skills[r]);
  if (!roles.length) return { ...base, state: 'warn', detail: tr('SKILL_NAMES não definido', 'SKILL_NAMES not set'), hint: 'Ex.: SKILL_NAMES=review=minha-review,daily=minha-daily' };
  const found = roles.filter(r => fs.existsSync(path.join(p, 'skills', cfg.skills[r]!, 'SKILL.md')));
  const state: CheckState = found.length === SKILL_ROLES.length ? 'ok' : found.length ? 'warn' : 'error';
  return { ...base, state, detail: `${found.length}/${SKILL_ROLES.length} ${tr('papéis com skill encontrada', 'roles with a skill found')}: ${found.join(', ') || tr('nenhum', 'none')}` };
}

function reposCheck(cfg: Config, tr: Tr): Check {
  const base = { id: 'repos', label: tr('Repositórios alvo', 'Target repositories') };
  const repos = cfg.paths.repos;
  if (!repos.length) return { ...base, state: 'off', detail: tr('REPOS não definido', 'REPOS not set'), hint: 'Ex.: REPOS=core=C:\\reps\\core;hooks=C:\\reps\\hooks' };
  const missing = repos.filter(r => !fs.existsSync(r.path)).map(r => r.slug);
  return missing.length
    ? { ...base, state: 'warn', detail: `${repos.length} ${tr('configurados', 'configured')} · ${tr('pasta ausente', 'missing folder')}: ${missing.join(', ')}` }
    : { ...base, state: 'ok', detail: `${repos.length} ${tr('configurados', 'configured')}: ${repos.map(r => r.slug).join(', ')}` };
}

export function infraCheck(cfg: Config, tr: Tr): Check {
  const base = { id: 'infra', label: tr('Infra (DigitalOcean, Heroku, Azure, Grafana)', 'Infra (DigitalOcean, Heroku, Azure, Grafana)') };
  const i = cfg.infra;
  const on = [i.digitalocean && 'DigitalOcean', i.heroku && 'Heroku', i.azure && 'Azure', i.grafana && 'Grafana'].filter(Boolean) as string[];
  if (cfg.demo.on) return { ...base, state: 'ok', detail: tr('dados fictícios do modo demonstração', 'demo mode fictitious data') };
  if (!on.length) return { ...base, state: 'off', detail: tr('nenhum provedor configurado', 'no provider configured'), hint: tr('Use tokens só de leitura: DIGITALOCEAN_TOKEN, HEROKU_API_KEY, AZURE_* (service principal com Monitoring Reader) ou GRAFANA_URL + GRAFANA_TOKEN (Viewer).', 'Use read-only tokens: DIGITALOCEAN_TOKEN, HEROKU_API_KEY, AZURE_* (service principal with Monitoring Reader) or GRAFANA_URL + GRAFANA_TOKEN (Viewer).') };
  return { ...base, state: 'ok', detail: `${on.join(', ')} · ${tr('leitura a cada', 'polling every')} ${i.pollSec} s` };
}

export async function healthRoutes(app: FastifyInstance, opts: { config: Config; store: PainelStore; featMaps: FeatMapRegistry }): Promise<void> {
  const cache = new Map<string, { at: number; checks: Check[] }>(); // por idioma

  app.get('/api/health', async (req) => {
    const query = req.query as Record<string, unknown>;
    const lang = query['lang'] === 'en' ? 'en' : 'pt-BR';
    const tr = trFor(lang);
    const fresh = query['fresh'] !== undefined;
    const hit = cache.get(lang);
    if (!fresh && hit && Date.now() - hit.at < 30_000) {
      return { checks: [mongoCheck(opts.store, tr), ...hit.checks.filter(c => c.id !== 'mongo')], limits: opts.config.limits };
    }
    const [claude, github, featmap] = await Promise.all([claudeCheck(tr), githubCheck(opts.config, tr), featMapCheck(opts.featMaps, tr)]);
    const checks = [mongoCheck(opts.store, tr), github, discordCheck(opts.config, tr), infraCheck(opts.config, tr), claude, featmap, skillsCheck(opts.config, tr), reposCheck(opts.config, tr)];
    cache.set(lang, { at: Date.now(), checks });
    return { checks, limits: opts.config.limits };
  });
}
