import { describe, expect, it } from 'vitest';
import { blockersFromChannels, blockersFromDailies, mergeBlockers, type ChannelMessage } from './blockers.js';
import type { DailyMessage } from './daily.js';

const team = [{ id: 'u1', name: 'ANA' }, { id: 'u2', name: 'HUGO' }];
const now = Date.parse('2026-11-16T15:00:00Z'); // 12:00 BRT

const daily = (id: string, authorId: string, ts: string, blockers: string): DailyMessage =>
  ({ id, authorId, timestamp: ts, content: `## Hoje\n- trabalho\n## Bloqueios\n${blockers}\nConfiança: 3/5` });

describe('blockers from the dailies', () => {
  it('open while it shows up in the latest daily; "since" comes from the first consecutive daily', () => {
    const msgs = [
      daily('1', 'u1', '2026-11-12T12:00:00Z', '- #300 antigo'),
      daily('2', 'u1', '2026-11-13T12:00:00Z', '- #100 sem acesso ao HML'),
      daily('3', 'u1', '2026-11-16T12:00:00Z', '- #100 sem acesso ao HML (ainda)'),
    ];
    const open = blockersFromDailies(msgs, team, now);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ issue: '100', since: '2026-11-13T12:00:00Z', source: 'daily' });
  });

  it('uses the written "(desde HH:MM)", in the team time zone', () => {
    const msgs = [daily('1', 'u2', '2026-11-16T12:30:00Z', '- #55 fila travada (desde 08:15) — depende de @infra')];
    const [b] = blockersFromDailies(msgs, team, now);
    expect(b?.since).toBe('2026-11-16T11:15:00.000Z'); // 08:15 BRT
    expect(b?.dependsOn).toBe('@infra');
    expect(b?.ageMs).toBe(3 * 3_600_000 + 45 * 60_000);
  });

  it('a blocker gone from the latest daily is resolved', () => {
    const msgs = [daily('1', 'u1', '2026-11-13T12:00:00Z', '- #100 x'), daily('2', 'u1', '2026-11-16T12:00:00Z', '- nenhum')];
    expect(blockersFromDailies(msgs, team, now)).toEqual([]);
  });
});

describe('blockers in the channels', () => {
  const ch = (id: string, authorId: string, ts: string, content: string): ChannelMessage => ({ id, authorId, timestamp: ts, content, channel: 'tickets' });

  it('detects it and closes it when the author says it was solved', () => {
    const msgs = [
      ch('1', 'u1', '2026-11-16T13:00:00Z', 'estou bloqueada no #812, sem acesso à VPN'),
      ch('2', 'u2', '2026-11-16T13:10:00Z', 'travado aqui também no deploy'),
      ch('3', 'u1', '2026-11-16T14:00:00Z', 'resolvido, obrigada!'),
    ];
    const open = blockersFromChannels(msgs, team, now);
    expect(open.map(b => b.member.name)).toEqual(['HUGO']);
  });

  it('ignores people outside the team and old messages', () => {
    const msgs = [ch('1', 'x', '2026-11-16T13:00:00Z', 'bloqueado'), ch('2', 'u1', '2026-11-10T13:00:00Z', 'bloqueado')];
    expect(blockersFromChannels(msgs, team, now)).toEqual([]);
  });
});

describe('merge', () => {
  it('dedup by person + issue keeping the oldest, sorted by age', () => {
    const d = blockersFromDailies([daily('1', 'u1', '2026-11-16T12:00:00Z', '- #812 VPN')], team, now);
    const c = blockersFromChannels([{ id: '9', authorId: 'u1', timestamp: '2026-11-16T10:00:00Z', content: 'bloqueada no #812', channel: 'tickets' }], team, now);
    const merged = mergeBlockers(d, c);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.since).toBe('2026-11-16T10:00:00Z');
    expect(merged[0]?.source).toBe('daily');
  });
});
