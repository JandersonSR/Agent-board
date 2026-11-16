# ADR 0019 — Concentração de conhecimento por repositório

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
Num time com muitos desenvolvedores e poucas pessoas sêniores, é comum só uma pessoa conseguir revisar ou mexer em certos repositórios. Isso é risco de entrega e de saída de pessoas, e não aparece em lugar nenhum.

## Decisão
- A sincronização passa a guardar, em cada PR acompanhado, **quem revisou** (sem o autor e sem bots), além de branch e labels.
- **Fator de ônibus** por repositório: o menor número de pessoas que, se saírem, deixam mais da metade dos PRs mergeados do período sem ninguém que escreveu ou revisou. Cálculo guloso, puro e testado.
- Risco alto com fator 1, médio com 2. Repositórios com menos de 5 PRs no período ficam marcados como "poucos dados".
- Destaque para quem revisa 80% ou mais dos PRs de um repositório e para PRs mergeados sem review.

## Consequências
- PRs sincronizados antes desta versão não têm revisores; eles entram como "desconhecido" e não contam como sem review.
- Mede participação em PRs, não domínio real do código. Serve para puxar a conversa (parear reviews, rodízio), não para avaliar pessoas.
