# ADR 0028 — Chat and issue tracker adapters

- **Status:** accepted
- **Date:** 2026-11-17

## Context
The daily, the blockers and the mentions came only from Discord, and the queue and deploy tracking only from GitHub Issues and Projects. Most teams use Slack, and many track work in Jira or Linear. The code read Discord's message shape directly, so supporting another chat meant touching the sync.

## Decision
- **Chat adapter** (`sources/chat.ts`): `ChatSource.messagesSince(channel, since)` returns `ChatMessage` (author, text, time, link, user and group mentions, reply or thread answers). Discord and Slack implement it. One chat at a time: `CHAT_PROVIDER`, or whichever has a token (Discord first, the previous behavior). Slack text is normalized (entities, `*bold*` → `**bold**`, links) so the daily parser stays the same.
- **Tracker adapter** (`sources/trackers.ts`): `myQueue()` and `issues(keys)` for Jira Cloud (REST v3 `search/jql`, API token) and Linear (GraphQL, personal API key). GitHub Issues and Projects stay as they are.
- **Linking PRs to Jira/Linear issues** by key (`LOAN-12`) in the PR title, branch or body, only for configured prefixes (`JIRA_PROJECT_KEYS`, `LINEAR_TEAM_KEYS`) so words like `UTF-8` or task ids do not match. A GitHub closing reference still wins. Keys unknown to the tracker leave the PR on its own. Tracked tracker issues are refreshed by searching PRs that mention the key.
- **Deploy date** from a Jira date field or Linear's due date, when configured; manual dates are never overwritten (same rule as GitHub Projects).
- Read-only everywhere: Slack only reads history and user names; JQL and GraphQL are built only from validated keys; tokens are masked in any text.

## Alternatives
- Slack Events API (push): faster, but needs a public endpoint and a signing secret. Polling the history fits the current local-only design; inbound events stay on the roadmap.
- Generic "any key" linking: too many false positives (`UTF-8`, `FEAT-101` task ids).

## Consequences
- The daily format is still the team's (Portuguese section names); making it configurable is next on the roadmap.
- Slack's history limits for apps distributed outside the Marketplace do not apply to an internal app; the docs ask for an internal app.
- The `/api/queue` source keys changed from `discord` to `chat` (plus `tracker`); queue items carry an `origin` label.
