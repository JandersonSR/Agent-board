# ADR 0027 — Code and data in English

- **Status:** accepted
- **Date:** 2026-11-17

## Context
TLDeck is an open-source project, but its code was written in Portuguese: comments, test names, log and error messages, agent prompts, the interface's source texts and the names of the collections (`painel_*`). That limits who can read and contribute, and it mixes two languages in every file. The tool is already in production for its author, so existing data must survive.

## Decision
- **Code in English:** comments, test names, logs, error messages and agent prompts. Data that is Portuguese on purpose stays as it is: the team's daily format (to be redefined later), masking labels for Brazilian documents, and the demo's Portuguese texts.
- **Interface:** the source text of each `t('…')` key is English; `i18n-pt.ts` holds the Portuguese version. Keys that read the same in English but not in Portuguese get a `|context` suffix that is never shown (`'Open|decisions'`). Fixed server error messages have their own Portuguese table, applied by the API client.
- **Collections renamed** from `painel_*` to `deck_*`. On connection the store renames old collections in place (SQLite `ALTER TABLE … RENAME`, MongoDB `renameCollection`, same database, no copy). An empty new collection is replaced; when old and new both hold data, nothing is touched and a warning is logged. The step is idempotent.
- **`CONTENT_LANG`** (`en` default, `pt-BR`) sets the language of everything the deck writes by itself: agent answers (the prompt asks for that language), PENDING review and draft PR bodies, alert titles, incident timelines. `INFRA_LANG` stays as an alias.
- Environment variables, the `~/.agent-board` folder, the `X-Agent-Board` header and the session file format do not change. The hook now writes English texts; the screen shows texts from old and new session files in the current language.
- New ADRs are written in English. Older ADRs stay in Portuguese as a historical record.

## Consequences
- Anyone upgrading gets the rename on the first start, with a log line listing what was renamed. Rolling back to v0.4 after that would need the reverse rename by hand.
- Teams that want reviews, PR bodies and alerts in Portuguese must set `CONTENT_LANG=pt-BR` (and `language: pt-BR` in the CI pre-review caller).
- Prompt versions changed (`r2`, `t2`), so AI review precision and recall start a new series.
