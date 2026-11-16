# ADR 0016 — Filtros por pessoa, time e repositório (mostrar só / ocultar)

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
Os blocos de reviews, fila e PRs/deploy misturam PRs de bots (como o dependabot, que tinha 36 PRs abertos), PRs do próprio Tech Lead e PRs de outros times. O Tech Lead quer escolher o que ver: mostrar só certas pessoas ou times, ou ocultar bots, os próprios PRs e devs específicos.

## Decisão
- **Filtros na tela, puros e testados** (`apps/web/src/lib/filters.ts`). O servidor continua entregando tudo; filtrar é uma escolha de visualização.
- **Facetas:** pessoa (login do autor), time e repositório. Cada valor tem três estados, alternados por clique: nada → **mostrar só** → **ocultar**.
- **Atalhos:** "Ocultar bots" (`[bot]`, dependabot, renovate, github-actions…) e "Ocultar os meus" (login vindo de `/api/github/people`).
- **Itens com vários autores** (issue de deploy):
  - "mostrar só" vale se **um** autor casar;
  - "ocultar" só esconde quando **todos** os autores estão ocultos. Uma entrega com PRs seus e de outro dev continua visível.
- **Times reais do GitHub:** `/api/github/people` lê os times da org e seus membros (escopo `read:org`, que o token já tem), com cache de 1 h. O time explícito editado na issue de deploy também conta.
- **Persistência:** os filtros ficam salvos por tela no navegador (`reviews`, `queue`, `deploy`). O bloco "PRs e deploy" da tela Hoje usa os mesmos filtros da tela de deploy. A busca por texto não é salva.
- **Contadores:** quando há filtro ativo, mostram "filtrados/total".

## Consequências
- Os PRs de deploy passam a guardar o login do autor (`author`). Itens migrados do painel antigo só têm o nome digitado à mão até a rotina associar os PRs reais.
