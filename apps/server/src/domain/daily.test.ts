import { describe, expect, it } from 'vitest';
import { parseDaily, summarizeDaily, type DailyMessage } from './daily.js';

// Textos fictícios no formato do template do time.
const TEMPLATE = `Bom dia @equipe

## Ontem - sexta-feira (2026-11-13)
- Ajustei o retry do consumer
- Revisei PR #9830

## Hoje - segunda-feira (2026-11-16)
- Finalizar endpoint de simulação

## Bloqueios
- #8406 aguardando acesso ao banco HML (desde 09:30) — depende de @diego

Confiança: 2/5`;

describe('parseDaily', () => {
  it('lê o template completo', () => {
    const d = parseDaily(TEMPLATE);
    expect(d.isDaily).toBe(true);
    expect(d.yesterday).toEqual(['Ajustei o retry do consumer', 'Revisei PR #9830']);
    expect(d.today).toEqual(['Finalizar endpoint de simulação']);
    expect(d.confidence).toBe(2);
    expect(d.blockers).toHaveLength(1);
    expect(d.blockers[0]).toMatchObject({ issue: '8406', since: '09:30', dependsOn: '@diego', inferred: false });
  });

  it('"- nenhum" significa sem bloqueios (e não usa fallback)', () => {
    const d = parseDaily('## Hoje - x\n- Corrigir travado o layout? não\n## Bloqueios\n- nenhum\nConfiança: 5/5');
    expect(d.blockers).toEqual([]);
    expect(d.confidence).toBe(5);
  });

  it('fallback por palavra-chave quando não há seção de bloqueios', () => {
    const d = parseDaily('Ontem:\n- Subi o PR\nHoje:\n- Continuo bloqueado esperando acesso à VPN #812');
    expect(d.blockers).toHaveLength(1);
    expect(d.blockers[0]).toMatchObject({ issue: '812', inferred: true });
  });

  it('aceita variações: negrito, "Bloqueios: nenhum" na linha, confiança sem /5', () => {
    const d = parseDaily('**Ontem**\n- a\n**Hoje**\n- b\nBloqueios: nenhum\n**Confiança:** 3');
    expect(d.yesterday).toEqual(['a']);
    expect(d.today).toEqual(['b']);
    expect(d.blockers).toEqual([]);
    expect(d.confidence).toBe(3);
  });

  it('item sem marcador começando com "Hoje" não vira cabeçalho', () => {
    const d = parseDaily('## Hoje\nHoje vou corrigir o bug do login');
    expect(d.today).toEqual(['Hoje vou corrigir o bug do login']);
  });

  it('mensagem comum não é daily', () => {
    expect(parseDaily('alguém sabe o endpoint de simulação?').isDaily).toBe(false);
  });
});

describe('summarizeDaily', () => {
  const team = [{ id: 'u1', name: 'ANA' }, { id: 'u2', name: 'HUGO' }, { id: 'u3', name: 'DIEGO' }];
  // 2026-11-16 12:00 UTC = 09:00 BRT
  const now = Date.parse('2026-11-16T12:00:00Z');
  const msgs: DailyMessage[] = [
    { id: '1', authorId: 'u1', timestamp: '2026-11-13T12:00:00Z', content: '## Hoje\n- x\n## Bloqueios\n- #100 sem acesso\nConfiança: 4/5' },
    { id: '2', authorId: 'u1', timestamp: '2026-11-16T11:50:00Z', content: '## Hoje\n- y\n## Bloqueios\n- #200 aguardando deploy\nConfiança: 2/5' },
    { id: '3', authorId: 'u2', timestamp: '2026-11-16T11:40:00Z', content: '## Hoje\n- z\n## Bloqueios\n- nenhum\nConfiança: 5/5' },
    { id: '4', authorId: 'u3', timestamp: '2026-11-16T11:45:00Z', content: 'bom dia! alguém viu o alerta?' },
  ];

  it('quem postou, quem não postou, confiança baixa e bloqueios', () => {
    const s = summarizeDaily(msgs, team, now);
    expect(s.day).toBe('2026-11-16');
    expect(s.postedCount).toBe(2);
    expect(s.missing.map(m => m.name)).toEqual(['DIEGO']);
    expect(s.lowConfidence.map(p => p.member.name)).toEqual(['ANA']);
    expect(s.blockers.map(b => b.blocker.issue)).toEqual(['200']);
  });

  it('o que mudou desde a daily anterior', () => {
    const ana = summarizeDaily(msgs, team, now).people.find(p => p.member.id === 'u1')!;
    expect(ana.changes.newBlockers.map(b => b.issue)).toEqual(['200']);
    expect(ana.changes.resolvedBlockers.map(b => b.issue)).toEqual(['100']);
    expect(ana.changes.confidenceDelta).toBe(-2);
  });

  it('daily de ontem à noite (BRT) não conta como hoje', () => {
    const late = [{ id: '9', authorId: 'u2', timestamp: '2026-11-16T02:00:00Z', content: '## Hoje\n- a' }]; // 23:00 BRT do dia 15
    expect(summarizeDaily(late, team, now).postedCount).toBe(0);
  });
});
