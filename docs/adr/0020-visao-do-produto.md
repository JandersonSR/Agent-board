# ADR 0020 — Visão do produto por etapas

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
O time entrega um produto por vez, dividido em etapas, com duplas por etapa. Faltava ver num só lugar o andamento de cada etapa, o que depende do quê e onde estão os riscos.

## Decisão
- Coleção própria `deck_initiatives`: iniciativa com objetivo, status e data alvo, e etapas com donos, status, dependências, data alvo, observações e riscos (alto, médio, baixo, com mitigação).
- O **progresso vem das issues acompanhadas** em PRs e deploy, ligadas por URL, `repo#123` ou texto no título. Uma issue conta como em produção quando está mergeada e a data de deploy já passou.
- Etapa em andamento com dependência não concluída aparece como "esperando dependência".
- **Caminho crítico**: a maior cadeia de etapas não concluídas, pesada pelo trabalho que falta em cada uma.
- Dependências circulares e dependências para etapas inexistentes são recusadas na validação.

## Consequências
- O progresso só é tão bom quanto a ligação das issues com as etapas.
- O peso do caminho crítico é o número de issues abertas, não uma estimativa de esforço.
