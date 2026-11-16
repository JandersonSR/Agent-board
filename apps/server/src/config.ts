// Configuração única do servidor: lê o .env da raiz do repo e valida com Zod.
// Nada da empresa fica no código — tudo vem daqui. Campo vazio = integração desligada.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Carrega o .env da raiz sem sobrescrever variáveis já definidas no processo. */
export function loadDotEnv(file = path.join(REPO_ROOT, '.env')): void {
  if (!fs.existsSync(file)) return;
  try { process.loadEnvFile(file); } catch { /* .env inválido: segue só com o ambiente */ }
}

const empty = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optStr = z.preprocess(empty, z.string().trim().optional());
const intWithDefault = (def: number, min: number, max: number) =>
  z.preprocess(empty, z.coerce.number().int().min(min).max(max).default(def));

/** "a:b,c:d" -> [{key:'a', value:'b'}, ...] */
function pairs(raw: string | undefined, sep = ',', kv = ':'): Array<{ key: string; value: string }> {
  if (!raw) return [];
  return raw.split(sep).map(p => p.trim()).filter(Boolean).map(p => {
    const i = p.indexOf(kv);
    return i < 0 ? { key: p, value: p } : { key: p.slice(0, i).trim(), value: p.slice(i + 1).trim() };
  });
}
const safeRegex = (p: string) => { try { return new RegExp(p, 'i'); } catch { return /deploy/i; } };
const list = (raw: string | undefined, sep = ',') => (raw ? raw.split(sep).map(s => s.trim()).filter(Boolean) : []);

const EnvSchema = z.object({
  AGENT_BOARD_PORT: intWithDefault(9999, 1024, 65535),
  AGENT_BOARD_WEB_DEV_PORT: intWithDefault(5173, 1024, 65535),
  AGENT_BOARD_APPROVAL_WAIT: intWithDefault(120, 0, 3600),

  MONGO_URI: optStr,
  MONGO_DATABASE_NAME: optStr,
  MONGO_DATABASE_USER: optStr,
  MONGO_DATABASE_PASS: optStr,
  MONGO_DATABASE_CLUSTERNAME: optStr,
  MONGO_DATABASE_CUSTERNAME: optStr, // grafia antiga aceita por compatibilidade
  MONGO_LEGACY_PR_DATABASE: optStr,
  MONGO_LEGACY_PR_COLLECTION: optStr,

  GITHUB_TOKEN: optStr,
  GITHUB_ORG: optStr,
  GITHUB_LOGIN: optStr,
  GITHUB_BOARD_REPO: optStr,
  TEAM_GITHUB_LOGINS: optStr,

  DISCORD_BOT_TOKEN: optStr,
  DISCORD_GUILD_ID: optStr,
  DISCORD_DAILY_CHANNEL_ID: optStr,
  DISCORD_WATCH_CHANNELS: optStr,
  DISCORD_MY_USER_ID: optStr,
  DISCORD_MY_ROLE_IDS: optStr,
  TEAM_DISCORD_MEMBERS: optStr,

  FEAT_MAPS: optStr,
  FEAT_MAP_ROUTES: optStr,
  FEAT_CONTEXT_TOKENS: intWithDefault(6000, 500, 50_000),
  SKILLS_KIT_PATH: optStr,
  SKILL_NAMES: optStr,
  WORKTREES_DIR: optStr,
  REPOS: optStr,

  MAX_CONCURRENT_SESSIONS: intWithDefault(2, 1, 10),
  SESSION_TIMEOUT_MIN: intWithDefault(20, 1, 180),
  MAX_DAILY_RUNS: intWithDefault(30, 1, 1000),
  POLL_INTERVAL_MIN: intWithDefault(5, 1, 120),

  MASK_EXTRA_PATTERNS: optStr,

  TEAM_TZ_OFFSET_MIN: z.preprocess(empty, z.coerce.number().int().min(-720).max(840).default(-180)),
  QUEUE_TYPE_ORDER: optStr,
  HOLIDAYS: optStr,
  PRS_LOOKBACK_DAYS: intWithDefault(14, 1, 90),
  GITHUB_PROJECTS: optStr,
  DEPLOY_DATE_FIELD: optStr,
  DEPLOY_LOOKBACK_DAYS: intWithDefault(7, 0, 90),
});

export const SKILL_ROLES = ['review', 'reviewInbox', 'daily', 'dailyDigest'] as const;
export type SkillRole = (typeof SKILL_ROLES)[number];

export type RawEnv = z.infer<typeof EnvSchema>;

export interface Config {
  port: number;
  webDevPort: number;
  approvalWait: number;
  mongo: { uri: string | undefined; dbName: string | undefined; legacyPr: { db: string; collection: string } | undefined };
  github: { token: string | undefined; org: string | undefined; login: string | undefined; boardRepo: string | undefined; team: Array<{ login: string; name: string }> };
  discord: {
    token: string | undefined; guildId: string | undefined; dailyChannelId: string | undefined;
    watchChannels: Array<{ label: string; id: string }>; myUserId: string | undefined; myRoleIds: string[];
    team: Array<{ id: string; name: string }>;
  };
  paths: {
    /** RAGs de features (clones locais): nome -> pasta. */
    featMaps: Array<{ name: string; path: string }>;
    skillsKit: string | undefined; worktrees: string; repos: Array<{ slug: string; path: string }>;
  };
  /** Papel -> nome da skill no kit (ex.: review=minha-skill-de-review). Nomes ficam no .env. */
  skills: Partial<Record<SkillRole, string>>;
  /** Qual RAG vale para qual repo alvo (globs no slug do repo). Sem rota = todos os RAGs. */
  featMapRoutes: Array<{ name: string; patterns: string[] }>;
  featContextTokens: number;
  limits: { maxConcurrent: number; timeoutMin: number; maxDailyRuns: number; pollIntervalMin: number };
  maskExtraPatterns: string[];
  team: { tzOffsetMin: number; holidays: Set<string> };
  queueTypeOrder: string | undefined;
  prsLookbackDays: number;
  deploy: { projects: number[]; dateField: RegExp; lookbackDays: number };
}

/** Monta a connection string no formato mongodb+srv (MONGO_URI tem prioridade). */
export function buildMongoUri(e: RawEnv): string | undefined {
  if (e.MONGO_URI) return e.MONGO_URI;
  const cluster = e.MONGO_DATABASE_CLUSTERNAME ?? e.MONGO_DATABASE_CUSTERNAME;
  const { MONGO_DATABASE_NAME: db, MONGO_DATABASE_USER: user, MONGO_DATABASE_PASS: pass } = e;
  if (!db || !user || !pass || !cluster) return undefined;
  return `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${cluster}.mongodb.net/${db}?retryWrites=true&w=majority`;
}

export function parseConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = EnvSchema.parse(env);
  const legacyDb = e.MONGO_LEGACY_PR_DATABASE;
  const legacyCol = e.MONGO_LEGACY_PR_COLLECTION;
  const skills: Config['skills'] = {};
  for (const { key, value } of pairs(e.SKILL_NAMES, ',', '=')) {
    if ((SKILL_ROLES as readonly string[]).includes(key) && value !== key) skills[key as SkillRole] = value;
  }
  return {
    port: e.AGENT_BOARD_PORT,
    webDevPort: e.AGENT_BOARD_WEB_DEV_PORT,
    approvalWait: e.AGENT_BOARD_APPROVAL_WAIT,
    mongo: {
      uri: buildMongoUri(e),
      dbName: e.MONGO_DATABASE_NAME,
      legacyPr: legacyDb && legacyCol ? { db: legacyDb, collection: legacyCol } : undefined,
    },
    github: {
      token: e.GITHUB_TOKEN, org: e.GITHUB_ORG, login: e.GITHUB_LOGIN, boardRepo: e.GITHUB_BOARD_REPO,
      team: pairs(e.TEAM_GITHUB_LOGINS).map(p => ({ login: p.key, name: p.value })),
    },
    discord: {
      token: e.DISCORD_BOT_TOKEN, guildId: e.DISCORD_GUILD_ID, dailyChannelId: e.DISCORD_DAILY_CHANNEL_ID,
      watchChannels: pairs(e.DISCORD_WATCH_CHANNELS).map(p => ({ label: p.key, id: p.value })),
      myUserId: e.DISCORD_MY_USER_ID, myRoleIds: list(e.DISCORD_MY_ROLE_IDS),
      team: pairs(e.TEAM_DISCORD_MEMBERS).map(p => ({ id: p.key, name: p.value })),
    },
    paths: {
      featMaps: pairs(e.FEAT_MAPS, ';', '=').map(p => ({ name: p.key, path: p.value })),
      skillsKit: e.SKILLS_KIT_PATH,
      worktrees: e.WORKTREES_DIR ?? path.join(os.homedir(), '.agent-board', 'worktrees'),
      repos: pairs(e.REPOS, ';', '=').map(p => ({ slug: p.key, path: p.value })),
    },
    limits: {
      maxConcurrent: e.MAX_CONCURRENT_SESSIONS,
      timeoutMin: e.SESSION_TIMEOUT_MIN,
      maxDailyRuns: e.MAX_DAILY_RUNS,
      pollIntervalMin: e.POLL_INTERVAL_MIN,
    },
    skills,
    featMapRoutes: pairs(e.FEAT_MAP_ROUTES, ';', '=').map(p => ({ name: p.key, patterns: list(p.value, '|') })),
    featContextTokens: e.FEAT_CONTEXT_TOKENS,
    maskExtraPatterns: list(e.MASK_EXTRA_PATTERNS, ';;'),
    team: { tzOffsetMin: e.TEAM_TZ_OFFSET_MIN, holidays: new Set(list(e.HOLIDAYS)) },
    queueTypeOrder: e.QUEUE_TYPE_ORDER,
    prsLookbackDays: e.PRS_LOOKBACK_DAYS,
    deploy: {
      projects: list(e.GITHUB_PROJECTS).map(Number).filter(n => Number.isInteger(n) && n > 0),
      dateField: safeRegex(e.DEPLOY_DATE_FIELD ?? 'deploy'),
      lookbackDays: e.DEPLOY_LOOKBACK_DAYS,
    },
  };
}
