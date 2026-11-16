# ADR 0024 — Sessões em segundo plano do agent view do Claude Code

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
Desde a v2.1.139 o Claude Code tem o agent view (`claude agents`): sessões em segundo plano, cada uma na própria worktree, gerenciadas no terminal. Ele cobre parte da tela de Agentes do painel. Essas sessões não chegam pelos hooks do painel, então ficavam invisíveis aqui.

## Decisão
- A aba **Em segundo plano** da tela de Agentes lista as sessões de `claude agents --json --all`: estado (`working`, `blocked`, `done`, `failed`, `stopped`), o que a sessão espera (`waitingFor`), projeto e idade. A contagem de sessões bloqueadas aparece na aba.
- Ações: ver os logs (`claude logs <id>`, mascarados), copiar `claude attach <id>` e **parar** (`claude stop <id>`, com confirmação).
- Só a **interface pública** do CLI é usada. Os arquivos em `~/.claude/jobs/` não são lidos (a documentação diz que não são estáveis).
- O id da sessão é validado (letras, números e hífen, sem começar por hífen) e vai como argumento, nunca por shell.
- O painel **não cria** sessões em segundo plano com texto livre: no Windows os CLIs do npm exigem shell, e um prompt arbitrário viraria risco de injeção. Para criar, use `claude --bg` ou `/bg` no terminal.
- Saída que não é JSON indica uma versão sem agent view; a aba explica como atualizar.
- No modo demonstração, sessões fictícias.

## Consequências
- Responder e aprovar continua no terminal (anexando) ou no próprio `claude agents`; o painel mostra o que precisa de atenção e o caminho.
- A listagem é consultada a cada 10 s, com cache de 4 s no servidor.
