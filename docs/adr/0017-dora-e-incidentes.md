# ADR 0017 — Métricas DORA e registro de incidentes

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
O painel já media o fluxo até o merge (ADR 0013), mas não o que acontece depois: com que frequência o time entrega, quanto do que entra em produção falha e quanto tempo leva para recuperar. Sem um registro de incidentes, também não existe base para propor SLOs.

## Decisão
- **Incidentes** ficam na coleção própria `deck_incidents`: severidade (SEV1 a SEV4), status, horários (início, detecção, mitigação, resolução), impacto, serviços, mudanças que causaram, correções, linha do tempo, ações com dono e prazo, e postmortem.
- O **postmortem é sem culpados** e sai em Markdown (`GET /api/incidents/:id/postmortem.md`), para colar num doc ou no repositório. SEV1/SEV2 resolvidos sem postmortem pronto aparecem como pendentes.
- **DORA** a partir do que o painel já guarda:
  - *Entrega* = issue mergeada com data de deploy no período. A frequência conta dias distintos de deploy por semana e o total de entregas.
  - *Tempo de entrega* = do primeiro PR visto pelo painel até o meio-dia (hora do time) da data de deploy. Mediana e p90.
  - *Mudança com falha* = entrega que é correção (hotfix, rollback, revert… pela regex `DORA_FAILURE_RE` no título, branch ou labels) ou que um incidente aponta como causa.
  - *Tempo de recuperação* = do início ao fim dos incidentes resolvidos no período.
- Textos livres passam pelo mascaramento antes de gravar (ADR 0004).

## Consequências
- A taxa de falha é uma **aproximação**: conta a correção como falha quando não há ligação explícita com a mudança que quebrou. Ligar a causa no incidente deixa o número mais fiel.
- O tempo de entrega herda o limite do ADR 0013 (início = quando o painel viu o PR).
- A qualidade das métricas depende de registrar incidentes, inclusive os pequenos.
