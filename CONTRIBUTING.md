# Contributing to TLDeck

Thanks for helping. *Português abaixo.*

## Setup

```bash
git clone https://github.com/JandersonSR/tldeck.git
cd tldeck
npm install
npm run demo        # the whole app with fictitious data, nothing to configure
npm run dev         # API (tsx watch) + web (Vite) for development
```

Node.js 22.13 or newer. No database to install: the default storage is a local SQLite file.

## Before opening a pull request

All of these run in CI and must pass:

```bash
npm run typecheck
npm test            # hooks (node --test) + server + web (Vitest)
npm run build
npm run test:e2e    # Playwright on the demo (CHROME_PATH=/path/to/chrome to use an installed Chrome)
```

Integration tests run against a real SQLite file. Set `MONGO_TEST_URI=mongodb://localhost:27017` to also run them, and the SQLite × MongoDB parity tests, against MongoDB.

## Rules that keep the project safe

- **Nothing leaves the machine without a click.** New actions that post, push or stop something need a confirmation dialog.
- **Mask before storing or sending.** Free text that goes to the database, a model or an error message passes through `privacy/mask.ts`.
- **Only the board's own collections** (`deck_*`, allowlist in `store/store.ts`).
- **No shell with user input.** Commands use `execCmd` with fixed or validated arguments.
- **Code, comments and test names are in English.** Data that is Portuguese on purpose (the daily format, masking labels, demo data) stays as it is.
- **Every UI text is translatable.** Write the English text inside `t('…')` (or `k('…')` in constants) and add the Portuguese version to `apps/web/src/lib/i18n-pt.ts`. A test fails if a translation is missing.
- **Decisions are written down.** A change in architecture, storage, security or a public contract gets an ADR in `docs/adr/`. Never put company-internal details (credentials, internal systems, customer data) in an ADR or a commit.

## Commits and pull requests

- Small, focused PRs with a description of the problem and how you verified the fix.
- Prefix commits with `feat:`, `fix:`, `test:`, `docs:`, `chore:` or `refactor:`.
- Add the change to `CHANGELOG.md` under *Unreleased*.

---

# Como contribuir

Obrigado pela ajuda. Os comandos são os mesmos de cima. Em resumo:

- Rode `npm run demo` para ver tudo funcionando sem configurar nada.
- Antes do PR, `npm run typecheck`, `npm test`, `npm run build` e `npm run test:e2e` precisam passar.
- Nada sai da máquina sem clique; texto livre passa pelo mascaramento; só as coleções `deck_*`; nada de shell com entrada do usuário.
- Código, comentários e nomes de testes em inglês. Todo texto da interface vai em `t('…')` em inglês, com a versão em português em `i18n-pt.ts`.
- Mudança de arquitetura, armazenamento, segurança ou contrato ganha um ADR em `docs/adr/`, **sem detalhes internos de empresa**.
- PRs pequenos, com o problema e como você verificou. Registre a mudança no `CHANGELOG.md`.
