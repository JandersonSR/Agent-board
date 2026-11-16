# ADR 0023 — Testes com banco real, ponta a ponta e serviço de agentes dividido

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
Os testes cobriam a lógica pura e as rotas sem banco. As consultas ao banco e a interface só eram conferidas à mão. O serviço de agentes concentrava review, tarefa e avaliação num arquivo de mais de 500 linhas.

## Decisão
- **Integração com banco real:** `integration.test.ts` sobe o app inteiro e passa por incidentes, DORA, conhecimento, decisões, produto, PRs e métricas do time. Roda sempre com SQLite (arquivo temporário) e, no CI, também com um MongoDB de serviço (`MONGO_TEST_URI`).
- **Paridade SQLite × MongoDB:** `parity.mongo.test.ts` grava os mesmos documentos nos dois e compara o resultado de cada consulta usada pelo painel e da ordenação. Garante que o armazenamento local (ADR 0022) se comporta como o MongoDB.
- **Interface ponta a ponta (Playwright):** os testes rodam contra o modo demonstração: todas as telas abrem sem erro de JavaScript, DORA e conhecimento com dados, registrar incidente e ação, criar decisão, julgar achado de review e trocar o idioma pelo atalho.
- **Serviço de agentes dividido:** `context.ts` (configuração, limites, log ao vivo, ciclo de vida do processo), `review-service.ts`, `task-service.ts` e `eval-service.ts`. `service.ts` virou uma fachada fina, então as rotas não mudaram.

## Consequências
- O CI ganha dois jobs (MongoDB e Playwright) e fica alguns minutos mais lento.
- Localmente, os testes com MongoDB ficam pulados sem `MONGO_TEST_URI`; os de interface rodam com `npm run test:e2e` (um Chrome instalado pode ser usado com `CHROME_PATH`).
