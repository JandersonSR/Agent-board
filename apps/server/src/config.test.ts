import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';

describe('parseConfig', () => {
  it('applies the default limits and port', () => {
    const c = parseConfig({});
    expect(c.port).toBe(9999);
    expect(c.limits).toEqual({ maxConcurrent: 2, timeoutMin: 20, maxDailyRuns: 30, pollIntervalMin: 5 });
    expect(c.mongo.uri).toBeUndefined();
  });

  it('treats an empty string as not configured', () => {
    const c = parseConfig({ DISCORD_BOT_TOKEN: '', MAX_CONCURRENT_SESSIONS: '' });
    expect(c.discord.token).toBeUndefined();
    expect(c.limits.maxConcurrent).toBe(2);
  });

  it('an empty STORAGE (as in .env.example) means auto', () => {
    expect(parseConfig({ STORAGE: '' }).mongo.storage).toBe('sqlite');
    expect(parseConfig({ STORAGE: '', MONGO_URI: 'mongodb://localhost/x' }).mongo.storage).toBe('mongo');
  });

  it('monta a URI do Mongo no formato legado (inclusive a grafia antiga CUSTERNAME)', () => {
    const c = parseConfig({
      MONGO_DATABASE_NAME: 'db', MONGO_DATABASE_USER: 'u@x', MONGO_DATABASE_PASS: 'p/s', MONGO_DATABASE_CUSTERNAME: 'c0',
    });
    expect(c.mongo.uri).toBe('mongodb+srv://u%40x:p%2Fs@c0.mongodb.net/db?retryWrites=true&w=majority');
  });

  it('MONGO_URI takes precedence', () => {
    expect(parseConfig({ MONGO_URI: 'mongodb://localhost/x', MONGO_DATABASE_NAME: 'y' }).mongo.uri).toBe('mongodb://localhost/x');
  });

  it('parses lists', () => {
    const c = parseConfig({
      DISCORD_WATCH_CHANNELS: 'tickets:111, revisao:222',
      REPOS: 'core=C:\\reps\\core;hooks=C:\\reps\\hooks',
      TEAM_GITHUB_LOGINS: 'dev1:Ana,dev2:Hugo',
      MASK_EXTRA_PATTERNS: 'A\\d+;;B\\d+',
    });
    expect(c.discord.watchChannels).toEqual([{ label: 'tickets', id: '111' }, { label: 'revisao', id: '222' }]);
    expect(c.paths.repos).toEqual([{ slug: 'core', path: 'C:\\reps\\core' }, { slug: 'hooks', path: 'C:\\reps\\hooks' }]);
    expect(c.github.team).toEqual([{ login: 'dev1', name: 'Ana' }, { login: 'dev2', name: 'Hugo' }]);
    expect(c.maskExtraPatterns).toEqual(['A\\d+', 'B\\d+']);
  });

  it('reads skill names per role and ignores unknown roles', () => {
    const c = parseConfig({ SKILL_NAMES: 'review=kit-review,daily=kit-daily,outro=x' });
    expect(c.skills).toEqual({ review: 'kit-review', daily: 'kit-daily' });
  });

  it('reads several feature RAGs and the routes per repo', () => {
    const c = parseConfig({ FEAT_MAPS: 'core=/maps/a;beta=/maps/b', FEAT_MAP_ROUTES: 'beta=beta-*|legacy-*;core=*' });
    expect(c.paths.featMaps).toEqual([{ name: 'core', path: '/maps/a' }, { name: 'beta', path: '/maps/b' }]);
    expect(c.featMapRoutes).toEqual([{ name: 'beta', patterns: ['beta-*', 'legacy-*'] }, { name: 'core', patterns: ['*'] }]);
    expect(c.featContextTokens).toBe(6000);
  });

  it('reads the deploy branches', () => {
    expect(parseConfig({ DEPLOY_BASE_BRANCHES: 'production, jobs' }).deploy.baseBranches).toEqual(['production', 'jobs']);
    expect(parseConfig({}).deploy.baseBranches).toEqual([]);
  });

  it('refuses limits out of range', () => {
    expect(() => parseConfig({ MAX_CONCURRENT_SESSIONS: '99' })).toThrow();
  });
});
