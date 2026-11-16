# ADR 0009 — Acompanhamento de deploy a partir da issue, e status re-review

- **Status:** aceito
- **Data:** 2026-11-16
- **Substitui em parte:** ADR 0007, onde a descoberta partia só dos autores (time)

## Contexto
No painel anterior cada PR era cadastrado à mão. Uma entrega (issue) costuma ter PRs em vários repos e várias bases (`main` e as branches de produção), de autores diferentes. A data de deploy fica no GitHub Project, mas às vezes é combinada fora dele. O fluxo de review também precisava distinguir **re-review**: as mudanças pedidas já foram atendidas e o PR espera nova revisão.

## Decisão
- **A unidade acompanhada é a issue.** Ela entra no acompanhamento de quatro formas:
  1. pelo Project (`GITHUB_PROJECTS`), quando tem data de deploy a partir de hoje − `DEPLOY_LOOKBACK_DAYS`;
  2. pelo campo "Acompanhar issue" no painel (link, `org/repo#n` ou número do board);
  3. pela migração do painel antigo;
  4. pelos PRs do time (`TEAM_GITHUB_LOGINS`, opcional).
- **PRs da issue encontrados sozinhos**, de qualquer autor ou repo, a cada sincronização:
  - os PRs que fecham a issue (`closedByPullRequestsReferences`);
  - os eventos `CONNECTED_EVENT` e `CROSS_REFERENCED_EVENT` (PRs que citam a issue).
  - As consultas vão em lotes de 10 issues.
- **Data de deploy:**
  - vem do campo do Project cujo nome casa com `DEPLOY_DATE_FIELD` (padrão `deploy`), seja campo de data, texto ou seleção com data escrita;
  - editar a data no painel a torna "manual", e o Project deixa de sobrescrevê-la;
  - datas migradas contam como manuais.
- **Escopo:** sem `read:project` no token, o painel funciona sem o Project, avisa na tela e aceita a data informada à mão.
- **Novo status `re_review`**, entre `rcs` e `waiting_approves`. É derivado quando a decisão é `CHANGES_REQUESTED` e, depois do último review com mudanças pedidas, houve commit novo ou novo pedido de review.
- **Ajuste manual por PR:** vale enquanto o status derivado do GitHub for o mesmo de quando foi marcado (`basis`). Quando o GitHub muda (novo review, aprovação ou merge), o ajuste cai sozinho. Também pode ser desfeito na tela.
- **"Parar de acompanhar"** arquiva a issue, e a rotina não a traz de volta.

## Consequências
- Sem cadastro de PR. Os 8 PRs cadastrados à mão de uma issue migrada foram reencontrados sozinhos, junto com outros 6 que nunca tinham sido cadastrados.
- Cada sincronização faz uma consulta GraphQL a mais para cada 10 issues acompanhadas.
- O status da issue continua sendo o do PR menos avançado ainda aberto.
