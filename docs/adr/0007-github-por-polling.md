# ADR 0007 — Eventos de PR do GitHub por polling da API

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
O painel de PRs anterior depende de cadastro manual. O webhook do GitHub no backend existente só trata `issues` e `projects_v2_item`, descarta `pull_request` e `pull_request_review` e não persiste nada de PR. O painel roda só em `127.0.0.1`, então não recebe webhooks sem um túnel.

## Decisão
- Polling a cada `POLL_INTERVAL_MIN` (padrão 5 min) e por botão, via GraphQL do GitHub:
  - PRs com `review-requested:@me` (bloco de reviews, com `additions`, `deletions` e idade);
  - PRs e issues com `assignee:@me` e `mentions:@me` (fila);
  - PRs abertos e recém-mergeados dos logins do time, com a issue que fecham. Isso faz o upsert em `painel_prs` e substitui o cadastro manual.
- O token vem de `GITHUB_TOKEN` ou, na falta dele, de `gh auth token`. Nunca vai para log nem para a tela.
- O status de deploy (`review_queue → reviewing → rcs → waiting_approves → merged`) é derivado do estado do PR. `deployDate`, vínculo e ordem de deploy continuam editáveis à mão.

## Alternativas
- **Webhook no backend persistindo PRs:** exige deploy do backend e uma coleção nova. Pode virar uma issue separada no futuro.

## Consequências
- O atraso máximo é o intervalo do polling. O botão de atualizar resolve quando é preciso agora.
- Custo de rate limit baixo: poucas consultas GraphQL a cada 5 minutos.
