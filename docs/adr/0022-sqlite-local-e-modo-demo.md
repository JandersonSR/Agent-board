# ADR 0022 — SQLite local como padrão e modo demonstração

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
Quase tudo que vai além das sessões de agentes (PRs e deploy, execuções, métricas, incidentes, decisões, produto) exigia MongoDB. Para quem chega pelo repositório aberto, isso é uma barreira: subir um banco antes de ver qualquer valor. Também não havia como mostrar o painel sem ligar GitHub e Discord.

## Decisão
- **Armazenamento padrão: um arquivo SQLite local** (`~/.agent-board/data.db`, ou `AGENT_BOARD_DB`), usando o `node:sqlite` que já vem no Node 22. Sem dependência nativa nem servidor.
- `store/sqlite-store.ts` implementa **o mesmo subconjunto da API de coleção do MongoDB** que os repositórios usam: consultas com `$eq/$ne/$gt(e)/$lt(e)/$in/$nin/$exists/$regex/$or/$and`, caminhos com pontos e arrays, ordenação, limite, projeção simples, `$set/$unset/$setOnInsert/$push($each/$slice)/$inc`, upsert e `findOneAndUpdate`. Operador desconhecido **gera erro**, em vez de ser ignorado.
- Cada coleção vira uma tabela `(id, doc JSON)`, com datas e ObjectId preservados (EJSON). O servidor mantém os documentos em memória depois da primeira leitura e grava cada mudança na hora (modo WAL).
- **MongoDB continua suportado**: com `MONGO_URI` (ou `STORAGE=mongo`) o painel usa o MongoDB como antes. `STORAGE=none` desliga o armazenamento.
- A allowlist de coleções próprias (`deck_*`) vale para os dois.
- **Modo demonstração** (`npm run demo`): banco SQLite temporário semeado com dados fictícios (entregas, incidentes, decisões, produto, execuções, conjunto de avaliação), fontes de GitHub e Discord fictícias e sessões de agentes de exemplo. Nenhuma integração real é usada, mesmo com `.env` preenchido.
- **Node 22.13 ou mais novo** passa a ser o mínimo (o Node 20 chegou ao fim do suporte em abril de 2026).

## Consequências
- A consulta é feita em memória: ótimo para o volume de um time (milhares de documentos), inadequado para dados de uma empresa inteira, caso em que o MongoDB é o caminho.
- O `node:sqlite` ainda é marcado como experimental no Node 22; o aviso é suprimido só no carregamento do módulo.
- A migração do painel de PRs anterior continua exigindo MongoDB.
- Os mesmos testes de integração rodam contra o SQLite real; o CI roda também contra MongoDB (ADR 0023).
