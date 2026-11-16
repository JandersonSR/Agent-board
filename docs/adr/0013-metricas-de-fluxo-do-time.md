# ADR 0013 — Métricas de fluxo do time a partir do histórico de PRs

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
O acompanhamento de PRs (ADR 0009) já guarda o histórico de status de cada PR. Faltava transformar isso em sinais de fluxo para o Tech Lead achar gargalos.

## Decisão
- Calculamos, por PR mergeado no período: tempo até o merge, espera pelo primeiro review, tempo e rodadas em "mudanças pedidas" e tamanho (linhas).
- Agregamos por semana (segunda-feira UTC), por time e por pessoa, com medianas. PRs repetidos entre issues contam uma vez (pela URL).
- PRs acima de 400 linhas são destacados como grandes. PRs esperando review há mais de um dia aparecem como alerta.
- O início de um PR é quando o painel o viu pela primeira vez, não a criação no GitHub.
- O cálculo é uma função pura (`domain/team-metrics.ts`) testada sem banco.

## Consequências
- **Mede o fluxo, não as pessoas.** A tela diz isso e a visão por pessoa existe para achar quem está bloqueado, não para ranquear.
- PRs anteriores ao painel ou que ele viu tarde têm tempos subestimados.
- Só cobre o que passa pelo acompanhamento de PRs; trabalho fora dele não aparece.
