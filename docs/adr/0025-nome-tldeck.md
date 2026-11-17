# ADR 0025 — Novo nome: TLDeck

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
"Agent Board" é um nome muito usado por outros projetos abertos (quadros kanban de agentes, extensões e pacotes npm) e sugere justamente a parte do projeto que virou recurso básico (o painel de sessões de agentes). O diferencial é ser o painel do Tech Lead: time, fila, entrega, confiabilidade e IA sob controle.

O primeiro nome escolhido, "Lead Deck", foi descartado antes do lançamento: em inglês, "lead" sozinho é lido como contato de vendas, e já existe um produto de gestão de leads com esse nome. "TechLead Deck" ficou longo demais.

## Decisão
- O projeto passa a se chamar **TLDeck** — "TL" de Tech Lead, com o subtítulo "o painel do Tech Lead" para quem não conhece a sigla (repositório `tldeck`, pacotes `tldeck`, `@tldeck/server` e `@tldeck/web`, versão 0.4.0).
- **Mantidos por compatibilidade:** as variáveis `AGENT_BOARD_*`, a pasta `~/.agent-board`, o cabeçalho `X-Agent-Board`, as chaves `ab3.*` do navegador e a detecção de hooks antigos no instalador. A pré-review no CI reconhece o marcador de comentário antigo.
- O README passa a começar pelo problema e pelo público, com um demo de um minuto, uma comparação honesta ("Por que não X?") e a segurança antes da parte técnica.
- Arquivos de projeto aberto: LICENSE (MIT), CONTRIBUTING, SECURITY, ROADMAP, CHANGELOG, modelos de issue e PR, e publicação de versão por tag.

## Consequências
- O GitHub redireciona o endereço antigo do repositório; clones existentes continuam funcionando, mas convém atualizar o `remote`.
- Aceitar `TLDECK_*` além de `AGENT_BOARD_*` fica no roadmap.
