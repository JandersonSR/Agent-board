import { describe, expect, it } from 'vitest';
import { parseConfig } from '../config.js';
import { discordCheck, trFor } from './health.js';

describe('health no idioma pedido', () => {
  it('português por padrão', () => {
    const c = discordCheck(parseConfig({}), trFor(undefined));
    expect(c.label).toBe('Discord (bot só leitura)');
    expect(c.detail).toBe('DISCORD_BOT_TOKEN não definido');
  });

  it('inglês com lang=en', () => {
    const c = discordCheck(parseConfig({}), trFor('en'));
    expect(c.label).toBe('Discord (read-only bot)');
    expect(c.detail).toBe('DISCORD_BOT_TOKEN not set');
    expect(c.hint).toMatch(/^Create a bot/);
  });
});
