# ADR 0002 — O hook e as libs do v2 continuam em JavaScript

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
O Claude Code e o Cursor executam o `hook.js` a cada evento: início de sessão, cada ferramenta, cada pedido de permissão. Ele precisa:
- iniciar em milissegundos;
- funcionar sem build e sem `node_modules`, porque é instalado em `~/.claude/settings.json` e `~/.cursor/hooks.json` apontando para este repo.

O `hook.js` usa `lib/store.js`, `lib/state.js`, `lib/transcript.js` e `lib/pricing.js`.

## Decisão
- `hook.js`, `install.js`, `demo.js` e `lib/*.js` continuam em JavaScript CommonJS sem dependências. Os testes deles seguem com `node --test` (`npm run test:hooks`).
- O servidor TypeScript consome essas libs por um **adaptador tipado** (`apps/server/src/legacy/v2.ts`, com `createRequire`).
- O contrato de arquivos com o hook **não muda**: `sessions/`, `decisions/`, `history/`, `events.jsonl` e o batimento em `server.json`.

## Consequências
- A instalação dos hooks e a aprovação pelo painel funcionam igual, com o servidor novo.
- Os tipos do adaptador precisam acompanhar mudanças em `lib/*.js`. O teste `app.test.ts` cobre o contrato principal (listar sessões, gravar decisão).
- Portar `lib/git.js`, `lib/launch.js` e `lib/metrics.js` para TS fica para quando forem alterados. Eles não são usados pelo hook.
