# ADR 0011 — Interface em português e inglês

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
O v2 tinha a interface em português e inglês. A v3 voltou a ter só português, com os textos escritos direto nos componentes. O repositório é público, e o README e a tela precisam servir também a quem não lê português.

## Decisão
- **Idiomas:** `pt-BR` e `en`. Na primeira visita, segue o idioma do navegador. A escolha fica salva no navegador (`ab3.lang`) e muda pelo botão PT/EN no topo, pelo atalho `L` ou em Configuração.
- **Sem biblioteca:** um módulo pequeno, `apps/web/src/lib/i18n.ts`.
  - A chave de cada texto é o próprio texto em português: `t('Minha fila')`. O código continua legível e não existe arquivo de chaves abstratas.
  - O inglês fica em `apps/web/src/lib/i18n-en.ts`. Chave sem tradução mostra o português.
  - Variáveis entram como `{nome}`: `t('{n} rodando', { n })`.
  - Constantes (menus, colunas, status) marcam o texto com `k('…')` e a tela chama `t()` na hora de mostrar.
- **Formatos:** datas, números e custo seguem o idioma (`16/11` e `US$ 0,11` em português; `11/16` e `$0.11` em inglês).
- **Servidor:** os textos da tela de Configuração (estado das integrações) vêm no idioma pedido por `GET /api/health?lang=en`. Os demais textos do servidor continuam em português.
- **Textos gravados pelo hook** (por exemplo "Pedindo permissão: …") continuam em português no disco, para não mudar o contrato de arquivos (ADR 0002). A tela traduz os prefixos conhecidos.
- **Conteúdo de pessoas e ferramentas** (títulos de issue, daily, respostas dos agentes) não é traduzido.

## Consequências
- O teste `i18n.test.ts` lê o código-fonte e falha se algum texto em `t()`, `k()` ou `plural()` não tiver tradução, ou se as `{variáveis}` do inglês forem diferentes das do português.
- Ao trocar o idioma, o conteúdo da tela é remontado (`key={lang}`). Filtros e diálogos abertos voltam ao estado inicial.
- Mensagens de erro vindas do servidor e das integrações aparecem no idioma original.
