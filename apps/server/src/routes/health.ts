// Estado de cada integração, para a tela de Configuração e os estados vazios dos blocos.
// Nunca devolve valores de segredos — só se estão presentes e funcionando.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { SKILL_ROLES, type Config } from '../config.js';
import type { PainelStore } from '../store/mongo.js';
import { execCmd } from '../util/exec.js';

export type CheckState = 'ok' | 'warn' | 'off' | 'error';
export interface Check { id: string; label: string; state: CheckState; detail: string; hint?: string }


async function claudeCheck(): Promise<Check> {
  const r = await execCmd('claude', ['--version'], { timeoutMs: 15_000 });
  if (!r.ok) return { id: 'claude', label: 'Claude Code CLI', state: 'error', detail: 'claude não encontrado no PATH', hint: 'Instale o Claude Code e faça login (claude /login).' };
  const apiKey = !!process.env.ANTHROPIC_API_KEY;
  return {
    id: 'claude', label: 'Claude Code CLI', state: 'ok',
    detail: `${r.stdout.trim()} · autenticação: ${apiKey ? 'ANTHROPIC_API_KEY presente (será removida nas sessões)' : 'login do Claude Code'}`,
  };
}

async function githubCheck(cfg: Config): Promise<Check> {
  const base = { id: 'github', label: 'GitHub' };
  if (!cfg.github.org) return { ...base, state: 'off', detail: 'GITHUB_ORG não definido', hint: 'Defina GITHUB_ORG no .env.' };
  if (cfg.github.token) return { ...base, state: 'ok', detail: `token do .env · org ${cfg.github.org}` };
  const r = await execCmd('gh', ['auth', 'status', '--active'], { timeoutMs: 15_000 });
  return r.ok
    ? { ...base, state: 'ok', detail: `gh autenticado · org ${cfg.github.org}` }
    : { ...base, state: 'error', detail: 'gh não autenticado', hint: 'Rode: gh auth login' };
}

function discordCheck(cfg: Config): Check {
  const base = { id: 'discord', label: 'Discord (bot só leitura)' };
  const d = cfg.discord;
  if (!d.token) return { ...base, state: 'off', detail: 'DISCORD_BOT_TOKEN não definido', hint: 'Crie um bot só com View Channels + Read Message History e Message Content intent.' };
  const missing = [!d.guildId && 'DISCORD_GUILD_ID', !d.dailyChannelId && 'DISCORD_DAILY_CHANNEL_ID', !d.myUserId && 'DISCORD_MY_USER_ID'].filter(Boolean);
  if (missing.length) return { ...base, state: 'warn', detail: `faltando: ${missing.join(', ')}` };
  return { ...base, state: 'ok', detail: `daily + ${d.watchChannels.length} canais observados · ${d.team.length} pessoas` };
}

function mongoCheck(store: PainelStore): Check {
  const base = { id: 'mongo', label: 'MongoDB (coleções painel_*)' };
  const s = store.status;
  switch (s.state) {
    case 'not_configured': return { ...base, state: 'off', detail: 'MONGO_* não definidos', hint: 'Preencha MONGO_URI ou MONGO_DATABASE_* no .env (banco próprio do painel).' };
    case 'connecting': return { ...base, state: 'warn', detail: 'conectando…' };
    case 'connected': return { ...base, state: 'ok', detail: `banco ${s.db}` };
    case 'error': return { ...base, state: 'error', detail: `falha: ${s.message}` };
  }
}

function featMapCheck(cfg: Config): Check {
  const base = { id: 'featmap', label: 'RAG de features' };
  const p = cfg.paths.featMap;
  const rel = cfg.paths.featMapInventory;
  if (!p || !rel) return { ...base, state: 'off', detail: 'FEAT_MAP_PATH/FEAT_MAP_INVENTORY não definidos' };
  const inv = path.join(p, rel);
  try {
    const data = JSON.parse(fs.readFileSync(inv, 'utf8')) as { feats?: unknown[]; updated?: string };
    return { ...base, state: 'ok', detail: `${data.feats?.length ?? 0} features · atualizado ${data.updated ?? '?'}` };
  } catch {
    return { ...base, state: 'error', detail: 'inventário de features não encontrado', hint: 'Confira FEAT_MAP_PATH e FEAT_MAP_INVENTORY.' };
  }
}

function skillsCheck(cfg: Config): Check {
  const base = { id: 'skills', label: 'Kit de skills (review, daily)' };
  const p = cfg.paths.skillsKit;
  if (!p) return { ...base, state: 'off', detail: 'SKILLS_KIT_PATH não definido' };
  const roles = SKILL_ROLES.filter(r => cfg.skills[r]);
  if (!roles.length) return { ...base, state: 'warn', detail: 'SKILL_NAMES não definido', hint: 'Ex.: SKILL_NAMES=review=minha-review,daily=minha-daily' };
  const found = roles.filter(r => fs.existsSync(path.join(p, 'skills', cfg.skills[r]!, 'SKILL.md')));
  const state: CheckState = found.length === SKILL_ROLES.length ? 'ok' : found.length ? 'warn' : 'error';
  return { ...base, state, detail: `${found.length}/${SKILL_ROLES.length} papéis com skill encontrada: ${found.join(', ') || 'nenhum'}` };
}

function reposCheck(cfg: Config): Check {
  const base = { id: 'repos', label: 'Repositórios alvo' };
  const repos = cfg.paths.repos;
  if (!repos.length) return { ...base, state: 'off', detail: 'REPOS não definido', hint: 'Ex.: REPOS=core=C:\\reps\\core;hooks=C:\\reps\\hooks' };
  const missing = repos.filter(r => !fs.existsSync(r.path)).map(r => r.slug);
  return missing.length
    ? { ...base, state: 'warn', detail: `${repos.length} configurados · pasta ausente: ${missing.join(', ')}` }
    : { ...base, state: 'ok', detail: `${repos.length} configurados: ${repos.map(r => r.slug).join(', ')}` };
}

export async function healthRoutes(app: FastifyInstance, opts: { config: Config; store: PainelStore }): Promise<void> {
  let cache: { at: number; checks: Check[] } | undefined;

  app.get('/api/health', async (req) => {
    const fresh = (req.query as Record<string, unknown>)['fresh'] !== undefined;
    if (!fresh && cache && Date.now() - cache.at < 30_000) {
      return { checks: [mongoCheck(opts.store), ...cache.checks.filter(c => c.id !== 'mongo')], limits: opts.config.limits };
    }
    const [claude, github] = await Promise.all([claudeCheck(), githubCheck(opts.config)]);
    const checks = [mongoCheck(opts.store), github, discordCheck(opts.config), claude, featMapCheck(opts.config), skillsCheck(opts.config), reposCheck(opts.config)];
    cache = { at: Date.now(), checks };
    return { checks, limits: opts.config.limits };
  });
}
