# Security policy

Lead Deck runs on your machine, reads your GitHub and Discord with your credentials and can start AI agents, so security reports are taken seriously.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private vulnerability reporting: the **Security** tab of this repository → **Report a vulnerability**. Include what an attacker can do, how to reproduce it and the version or commit.

You will get an answer within 7 days. Fixes are released as soon as possible and credited in the changelog, unless you prefer to stay anonymous.

## Scope

Especially relevant:

- Bypassing the local-only guard (host, origin and header checks) or triggering writes from a web page.
- Personal data or secrets reaching the database, a model, logs or error messages without masking.
- Command injection through any input that reaches `execCmd`, `git` or the Claude/Cursor CLIs.
- An agent escaping its tool allowlist (for example pushing, posting to GitHub or reaching the network when it should not).

## Supported versions

Only the latest release gets security fixes.

---

*Português:* não abra issue pública para falhas de segurança. Use **Security → Report a vulnerability** neste repositório, com o impacto, como reproduzir e a versão. A resposta vem em até 7 dias.
