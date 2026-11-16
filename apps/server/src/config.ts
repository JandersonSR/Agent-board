// Configuração única do servidor: lê o .env da raiz do repo e valida com Zod.
// Nada da empresa fica no código — tudo vem daqui. Campo vazio = integração desligada.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DEFAULT_FAILURE_RE } from './domain/dora.js';

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
  STORAGE: z.enum(['auto', 'sqlite', 'mongo', 'none']).default('auto'),
  AGENT_BOARD_DB: optStr,
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
  REPOS_ROOT: optStr,
  AGENT_MODEL_REVIEW: optStr,
  AGENT_MODEL_TASK: optStr,

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
  DEPLOY_BASE_BRANCHES: optStr,
  TASK_TEST_COMMANDS: optStr,
  TASK_VERIFY: optStr,
  DORA_FAILURE_RE: optStr,
  DEMO: optStr,
  INFRA_POLL_SEC: intWithDefault(60, 15, 3600),
  INFRA_CPU_WARN: intWithDefault(80, 1, 100),
  INFRA_CPU_CRIT: intWithDefault(90, 1, 100),
  INFRA_MEM_CRIT: intWithDefault(90, 1, 100),
  INFRA_SUSTAIN_MIN: intWithDefault(5, 0, 120),
  INFRA_AUTO_INCIDENT: z.preprocess(empty, z.enum(['critical', 'off']).default('critical')),
  INFRA_PROD_RE: optStr,
  INFRA_LANG: optStr,
  DIGITALOCEAN_TOKEN: optStr,
  DIGITALOCEAN_TAG: optStr,
  HEROKU_API_KEY: optStr,
  HEROKU_APPS: optStr,
  AZURE_TENANT_ID: optStr,
  AZURE_CLIENT_ID: optStr,
  AZURE_CLIENT_SECRET: optStr,
  AZURE_SUBSCRIPTION_ID: optStr,
  AZURE_HEALTH_API_VERSION: optStr,
  GRAFANA_URL: optStr,
  GRAFANA_TOKEN: optStr,
  DEMO_LANG: optStr,
});

export const SKILL_ROLES = ['review', 'reviewInbox', 'daily', 'dailyDigest'] as const;
export type SkillRole = (typeof SKILL_ROLES)[number];

export type RawEnv = z.infer<typeof EnvSchema>;

export interface Config {
  port: number;
  webDevPort: number;
  approvalWait: number;
  mongo: {
    uri: string | undefined; dbName: string | undefined; legacyPr: { db: string; collection: string } | undefined;
    /** Onde o painel guarda os dados: arquivo SQLite local (padrão), MongoDB (com MONGO_URI) ou nada. */
    storage?: 'sqlite' | 'mongo' | 'none'; sqliteFile?: string;
  };
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
    /** Pasta onde ficam os clones (repo "x" = <reposRoot>/x quando não está em REPOS). */
    reposRoot: string;
    /** Pasta das execuções em segundo plano (cwd isolado dos agentes de review). */
    runs: string;
  };
  /** Papel -> nome da skill no kit (ex.: review=minha-skill-de-review). Nomes ficam no .env. */
  skills: Partial<Record<SkillRole, string>>;
  /** Qual RAG vale para qual repo alvo (globs no slug do repo). Sem rota = todos os RAGs. */
  featMapRoutes: Array<{ name: string; patterns: string[] }>;
  featContextTokens: number;
  agentModels: { review: string; task: string };
  limits: { maxConcurrent: number; timeoutMin: number; maxDailyRuns: number; pollIntervalMin: number };
  maskExtraPatterns: string[];
  team: { tzOffsetMin: number; holidays: Set<string> };
  queueTypeOrder: string | undefined;
  prsLookbackDays: number;
  deploy: { projects: number[]; dateField: RegExp; lookbackDays: number; baseBranches: string[] };
  /** Tarefas de ponta a ponta: comandos que o agente pode rodar e a verificação independente por repo. */
  tasks: { testCommands: string[]; verify: Array<{ repo: string; command: string }> };
  /** Regex que marca uma entrega como correção de falha (hotfix, rollback, revert…) nas métricas DORA. */
  dora: { failureRe: string };
  /** Modo demonstração: dados fictícios, nenhuma integração real, banco local temporário. */
  demo: { on: boolean; lang: 'pt-BR' | 'en' };
  /** Infraestrutura em tempo real (só leitura): provedores, limites dos alertas e regra de incidente automático. */
  infra: {
    pollSec: number; cpuWarn: number; cpuCrit: number; memCrit: number; sustainMin: number;
    autoIncident: 'critical' | 'off'; prodRe: string; lang: 'pt-BR' | 'en';
    digitalocean?: { token: string; tag?: string | undefined } | undefined;
    heroku?: { token: string; apps: string[] } | undefined;
    azure?: { tenantId: string; clientId: string; clientSecret: string; subscriptionId: string; healthApiVersion?: string | undefined } | undefined;
    grafana?: { url: string; token: string } | undefined;
  };
}

/** Comandos de teste/build que o agente pode rodar na worktree (prefixos; o resto é negado). */
export const DEFAULT_TASK_COMMANDS = [
  'npm test', 'npm run test', 'npm run lint', 'npm run typecheck', 'npm run build', 'pnpm test', 'yarn test', 'npx vitest',
  'dotnet build', 'dotnet test', 'mvn test', './mvnw test', 'gradle test', './gradlew test', 'go test', 'pytest', 'bundle exec rspec',
];

/** Monta a connection string no formato mongodb+srv (MONGO_URI tem prioridade). */
export function buildMongoUri(e: RawEnv): string | undefined {
  if (e.MONGO_URI) return e.MONGO_URI;
  const cluster = e.MONGO_DATABASE_CLUSTERNAME ?? e.MONGO_DATABASE_CUSTERNAME;
  const { MONGO_DATABASE_NAME: db, MONGO_DATABASE_USER: user, MONGO_DATABASE_PASS: pass } = e;
  if (!db || !user || !pass || !cluster) return undefined;
  return `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${cluster}.mongodb.net/${db}?retryWrites=true&w=majority`;
}

export const parseConfig = (env: NodeJS.ProcessEnv = process.env): Config => demoConfig(parseConfigRaw(env));

function parseConfigRaw(env: NodeJS.ProcessEnv): Config {
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
      storage: e.STORAGE === 'auto' ? (buildMongoUri(e) ? 'mongo' : 'sqlite') : e.STORAGE,
      sqliteFile: e.AGENT_BOARD_DB ?? path.join(os.homedir(), '.agent-board', 'data.db'),
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
      reposRoot: e.REPOS_ROOT ?? path.dirname(REPO_ROOT),
      runs: path.join(os.homedir(), '.agent-board', 'runs'),
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
    agentModels: { review: e.AGENT_MODEL_REVIEW ?? 'sonnet', task: e.AGENT_MODEL_TASK ?? 'sonnet' },
    maskExtraPatterns: list(e.MASK_EXTRA_PATTERNS, ';;'),
    team: { tzOffsetMin: e.TEAM_TZ_OFFSET_MIN, holidays: new Set(list(e.HOLIDAYS)) },
    queueTypeOrder: e.QUEUE_TYPE_ORDER,
    prsLookbackDays: e.PRS_LOOKBACK_DAYS,
    deploy: {
      projects: list(e.GITHUB_PROJECTS).map(Number).filter(n => Number.isInteger(n) && n > 0),
      dateField: safeRegex(e.DEPLOY_DATE_FIELD ?? 'deploy'),
      lookbackDays: e.DEPLOY_LOOKBACK_DAYS,
      baseBranches: list(e.DEPLOY_BASE_BRANCHES),
    },
    tasks: {
      testCommands: e.TASK_TEST_COMMANDS ? list(e.TASK_TEST_COMMANDS) : DEFAULT_TASK_COMMANDS,
      verify: pairs(e.TASK_VERIFY, ';', '=').map(p => ({ repo: p.key, command: p.value })),
    },
    dora: { failureRe: validRegex(e.DORA_FAILURE_RE) ?? DEFAULT_FAILURE_RE },
    demo: { on: e.DEMO === '1' || e.DEMO === 'true', lang: (e.DEMO_LANG ?? '').toLowerCase().startsWith('en') ? 'en' : 'pt-BR' },
    infra: {
      pollSec: e.INFRA_POLL_SEC, cpuWarn: e.INFRA_CPU_WARN, cpuCrit: e.INFRA_CPU_CRIT, memCrit: e.INFRA_MEM_CRIT, sustainMin: e.INFRA_SUSTAIN_MIN,
      lang: ((e.DEMO === '1' || e.DEMO === 'true') ? (e.DEMO_LANG ?? '') : (e.INFRA_LANG ?? '')).toLowerCase().startsWith('en') ? 'en' : 'pt-BR',
      autoIncident: e.INFRA_AUTO_INCIDENT, prodRe: validRegex(e.INFRA_PROD_RE) ?? '\\b(prod|production|prd)\\b',
      digitalocean: e.DIGITALOCEAN_TOKEN ? { token: e.DIGITALOCEAN_TOKEN, tag: e.DIGITALOCEAN_TAG } : undefined,
      heroku: e.HEROKU_API_KEY ? { token: e.HEROKU_API_KEY, apps: list(e.HEROKU_APPS) } : undefined,
      azure: e.AZURE_TENANT_ID && e.AZURE_CLIENT_ID && e.AZURE_CLIENT_SECRET && e.AZURE_SUBSCRIPTION_ID
        ? { tenantId: e.AZURE_TENANT_ID, clientId: e.AZURE_CLIENT_ID, clientSecret: e.AZURE_CLIENT_SECRET, subscriptionId: e.AZURE_SUBSCRIPTION_ID, healthApiVersion: e.AZURE_HEALTH_API_VERSION }
        : undefined,
      grafana: e.GRAFANA_URL && e.GRAFANA_TOKEN ? { url: e.GRAFANA_URL, token: e.GRAFANA_TOKEN } : undefined,
    },
  };
}

/** No modo demo nenhuma integração real é usada, mesmo que o .env tenha tokens. */
export function demoConfig(c: Config): Config {
  if (!c.demo.on) return c;
  return {
    ...c,
    mongo: { ...c.mongo, uri: undefined, legacyPr: undefined, storage: 'sqlite', sqliteFile: process.env.AGENT_BOARD_DB ?? path.join(os.tmpdir(), 'agent-board-demo', 'data.db') },
    github: { ...c.github, token: undefined, org: undefined },
    discord: { ...c.discord, token: undefined },
    infra: { ...c.infra, digitalocean: undefined, heroku: undefined, azure: undefined, grafana: undefined },
    paths: { ...c.paths, featMaps: [] },
  };
}

function validRegex(src: string | undefined): string | undefined {
  if (!src) return undefined;
  try { new RegExp(src, 'i'); return src; } catch { return undefined; }
}
