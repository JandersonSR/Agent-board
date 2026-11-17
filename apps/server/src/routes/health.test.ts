import { describe, expect, it } from 'vitest';
import { parseConfig } from '../config.js';
import { chatCheck, trackerCheck, trFor } from './health.js';

describe('health in the requested language', () => {
  it('Portuguese by default', () => {
    const c = chatCheck(parseConfig({}), trFor(undefined));
    expect(c.label).toBe('Chat do time (Discord ou Slack, só leitura)');
    expect(c.detail).toBe('nenhum chat configurado');
  });

  it('English with lang=en', () => {
    const c = chatCheck(parseConfig({}), trFor('en'));
    expect(c.detail).toBe('no chat configured');
    expect(c.hint).toMatch(/^Discord: a bot/);
  });
});

describe('chat and tracker checks', () => {
  it('Slack: lists what is missing, then the channels and people', () => {
    const tr = trFor('en');
    expect(chatCheck(parseConfig({ SLACK_BOT_TOKEN: 'xoxb-1' }), tr)).toMatchObject({ state: 'warn', label: 'Slack (read-only app)', detail: 'missing: SLACK_DAILY_CHANNEL_ID, SLACK_MY_USER_ID, TEAM_SLACK_MEMBERS' });
    const ok = chatCheck(parseConfig({ SLACK_BOT_TOKEN: 'xoxb-1', SLACK_DAILY_CHANNEL_ID: 'C1', SLACK_MY_USER_ID: 'U1', TEAM_SLACK_MEMBERS: 'U2:Ana', SLACK_WATCH_CHANNELS: 'support:C2' }), tr);
    expect(ok).toMatchObject({ state: 'ok', detail: 'daily + 1 watched channels · 1 people' });
  });

  it('CHAT_PROVIDER picks Slack even when Discord also has a token', () => {
    expect(chatCheck(parseConfig({ DISCORD_BOT_TOKEN: 'd', SLACK_BOT_TOKEN: 'x', CHAT_PROVIDER: 'slack' }), trFor('en')).label).toBe('Slack (read-only app)');
    expect(parseConfig({ DISCORD_BOT_TOKEN: 'd', SLACK_BOT_TOKEN: 'x' }).chatProvider).toBe('discord');
  });

  it('trackers: off with a hint, then the keys and the deploy date source', () => {
    const tr = trFor('en');
    expect(trackerCheck(parseConfig({}), tr)).toMatchObject({ state: 'off', detail: 'GitHub Issues and Projects only' });
    const c = trackerCheck(parseConfig({
      JIRA_BASE_URL: 'https://acme.atlassian.net', JIRA_EMAIL: 'a@acme.dev', JIRA_API_TOKEN: 't', JIRA_PROJECT_KEYS: 'loan,crm', JIRA_DEPLOY_DATE_FIELD: 'customfield_10050',
      LINEAR_API_KEY: 'lin', LINEAR_DUE_DATE_IS_DEPLOY: 'true',
    }), tr);
    expect(c.detail).toBe('Jira (LOAN, CRM · deploy date customfield_10050) · Linear (no keys: queue only · due date = deploy)');
  });
});
