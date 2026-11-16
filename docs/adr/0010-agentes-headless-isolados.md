# ADR 0010 — Agentes em segundo plano: Claude Code isolado, só leitura na review

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
O Tech Lead quer pedir a review de um PR, e depois a execução de uma tarefa, a um LLM com um clique. O kit do time só tem prompts (skills) e um MCP de contexto (feat-map); ele não executa agentes. Na máquina há o Claude Code CLI 2.1.325 e o Cursor 3.24, cujo CLI de agente não está instalado.

Uma execução não interativa com a configuração global do usuário carregava cerca de 154 mil tokens de contexto mesmo para um prompt trivial, por causa de CLAUDE.md, plugins, skills e hooks.

## Decisão
- **Em segundo plano:** `claude -p --output-format stream-json`, chamado sem shell (argumentos em array e prompt pela entrada padrão).
- **Isolamento:** `--setting-sources ""`, `--strict-mcp-config` e `--mcp-config`, que leva só o feat-map do kit. O contexto base cai para ~4 mil tokens e o login do Claude Code continua valendo. `--bare` não serve, porque exige chave de API.
- `ANTHROPIC_API_KEY` é removida do ambiente do processo, para nunca cobrar a API por engano.
- **Permissões:** `--permission-mode dontAsk` com `--tools`/`--allowedTools`. O que não está liberado é negado sem perguntar.
- **Review, só leitura:**
  - liberados: `Read`, `Grep`, `Glob`, `gh pr view`, `gh pr diff`, `gh pr checks` e as ferramentas do feat-map;
  - **negados:** `gh api`, `gh pr review/comment/merge/close/edit`, `gh issue`, `git push`, `curl`, `wget`, `WebFetch` e `WebSearch`.
- **Prompt:**
  - a skill de review do kit, com o nome vindo de `SKILL_NAMES`;
  - as features do RAG certo para o repo;
  - regras próprias desta execução: não perguntar, não postar, devolver JSON.
  - O texto passa pelo mascaramento, inclusive quando editado na prévia.
- **Resultado:** JSON validado com Zod (veredito, pronto para produção, confiança, riscos, bloqueadores, achados com arquivo e linha).
- **Review PENDING:** passo separado, por clique e com confirmação. Achados em linhas do diff viram comentários na linha; os demais vão no corpo. Sem `event`, a review fica pendente e só o Tech Lead a submete. Nunca aprova.
- **Execuções** ficam em `painel_sessoes`, com prompt mascarado, log mascarado (últimas 400 entradas), tokens, custo, duração e ações.
- **Limites:** `MAX_CONCURRENT_SESSIONS`, `MAX_DAILY_RUNS` (por dia no fuso do time) e `SESSION_TIMEOUT_MIN`, que encerra a árvore de processos. Execuções que ficaram "rodando" quando o servidor reiniciou são marcadas como falha.
- **Alternativas interativas:** "Abrir no terminal" usa o launcher do v2 com o Claude interativo, e a sessão aparece no quadro de Agentes. "Abrir no Cursor" abre o repo e copia o comando da skill.

## Consequências
- Uma review real de um PR pequeno levou 38 s e custou ~US$ 0,11.
- As execuções em segundo plano não disparam os hooks do usuário, então não aparecem no quadro de Agentes. Elas aparecem em Execuções.
- O diff do PR vai ao modelo. Código não deve conter dados de clientes; o que vai no prompt passa pelo mascaramento.
