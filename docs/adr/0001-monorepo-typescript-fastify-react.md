# ADR 0001 — Monorepo TypeScript: Fastify (API) + React/Vite (tela única)

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
O Agent Board v2 era JavaScript sem dependências: um `server.js` HTTP e um `public/index.html` com o front montado à mão.
A v3 junta o v2 (agentes ao vivo), o painel anterior de PRs/deploy e os blocos novos (daily, fila, bloqueios, reviews, sessões de resolução, avisos).
São requisitos: TypeScript estrito, validação com Zod nas bordas, Vitest e uma interface de nível profissional.

## Decisão
- Monorepo com npm workspaces: `apps/server` e `apps/web`.
- **Servidor:** Node 20 + TypeScript `strict` + `noUncheckedIndexedAccess`, Fastify 5 e Zod 4 em toda entrada (env, body, query, params) e em toda resposta de fonte externa.
- **Web:** React + Vite numa única página, com Tailwind e shadcn/ui (ver ADR 0005).
- **Testes:** Vitest para as regras (mascaramento, guarda de origem, allowlist de coleções, config; depois ordenação da fila e detecção de bloqueio).
- **Rede:** em produção local o servidor serve o build da web. Em desenvolvimento, o Vite faz proxy de `/api` e `/events`.
- **Bind:** sempre `127.0.0.1`. Não é configurável.

## Alternativas consideradas
- **Manter vanilla JS:** o v2 já mostra o limite. A UI é redesenhada inteira a cada evento e o estado de tela é preservado à mão.
- **Next.js:** SSR, rotas e build próprios não trazem ganho para uma ferramenta local de uma página.
- **Express (usado no painel de PRs anterior):** o Fastify é mais rápido, tem hooks tipados e testes por `inject` sem abrir porta.

## Consequências
- O build passa a existir (`npm run build`). Para desenvolver, `npm run dev`.
- O `server.js` e o `public/index.html` do v2 continuam como `npm run start:legacy` até a nova tela ter paridade. Depois são removidos.
