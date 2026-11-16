# ADR 0008 — Vários RAGs de features, lidos por um contrato comum

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
O contexto de features das sessões vem de RAGs mantidos como repositórios git, clonados localmente. Hoje são dois e podem surgir outros. Os esquemas internos diferem:
- **campos dos packs:** `domain`/`slug`/`tokenBudgetHint` num, `kind`/`keywords`/`tokens` no outro;
- **inventário:** só um deles tem um JSON de inventário.

Os dois têm em comum duas coisas: um `AGENTS.md` e um `packs/_index.yaml` que lista packs YAML com `id`, `title`, `summary` e `repos`.

## Decisão
- **Contrato mínimo** de um RAG: a pasta tem `packs/_index.yaml` com `packs[].{id, path}`. Os demais campos são opcionais e normalizados para:
  - `title`
  - `domain|kind`
  - `repos`
  - `keywords`
  - `summary`
  - `tokens`
- **Configuração só no `.env`:**
  - `FEAT_MAPS=nome=pasta;…` para quantos RAGs houver;
  - `FEAT_MAP_ROUTES=nome=glob|glob;…` para dizer qual RAG vale para qual repo alvo;
  - `FEAT_CONTEXT_TOKENS` para o orçamento por prompt.
- **Roteamento:**
  - um repo que casa com uma rota usa só os RAGs dessa rota;
  - os demais repos usam os RAGs sem rota;
  - sem repo, a busca vai em todos.
- **Busca lexical e determinística** (sem embeddings):
  - os pesos vêm do campo onde o termo casou (id > título > keywords/domínio/repos > resumo);
  - o repo alvo dá um bônus, mas só para packs que já casaram com o texto;
  - resultados abaixo de 35% do melhor são cortados;
  - o total respeita o orçamento de tokens.
  - A saída mostra "casou em: …", para o Tech Lead conferir o porquê de cada pack no preview do prompt.
- **Leitura dos clones:** cache por `mtime` do índice. O painel só lê os clones e roda git de leitura (`log`, `remote`, `rev-list`). Mostra os commits atrás do upstream, mas **nunca** faz pull.
- **Dependência:** `yaml`, sem dependências próprias.

## Consequências
- Um RAG novo entra com uma linha no `.env`, desde que siga o contrato mínimo.
- Busca semântica (embeddings) fica para depois, se a lexical se mostrar insuficiente. A interface de busca permite trocar a implementação.
- A seção "RAGs de features" em Configuração mostra o estado de cada RAG e permite testar a busca.
