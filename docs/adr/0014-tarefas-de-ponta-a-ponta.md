# ADR 0014 — Tarefas de ponta a ponta com portões

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
O painel já pedia reviews ao Claude. O passo seguinte é deixar um agente resolver uma issue até o PR, sem perder controle sobre o que sai da máquina e sem confiar no relato do próprio agente.

## Decisão
Uma tarefa é uma execução `kind: 'task'` com fases: `planning → awaiting_approval → implementing → verifying → ready → pr_opened` (ou `discarded` / `failed`).

1. **Plano só de leitura.** O agente recebe a issue (mascarada) e só tem ferramentas de leitura. Devolve um plano estruturado (passos, arquivos, testes, riscos, dúvidas).
2. **Portão humano.** Nada é alterado antes de alguém aprovar o plano. As observações da aprovação entram no prompt da implementação.
3. **Worktree isolada.** A implementação roda numa `git worktree` nova, na branch `agent/<número>-<slug>`, a partir da base remota. O agente só pode rodar os comandos de teste permitidos (`TASK_TEST_COMMANDS`) e git local (`status`, `diff`, `log`, `add`, `commit`). Push, remotos, troca de branch, reset, rebase, `gh`, rede e `rm -rf` ficam bloqueados.
4. **Verificação independente.** Depois do agente, o próprio painel roda o comando de `TASK_VERIFY` do repositório. Uma tarefa sem commits falha.
5. **PR só no clique.** Push e PR em rascunho (que fecha a issue) só com confirmação. Descartar remove a worktree e a branch local.

O texto da issue é tratado como dado de terceiros: os prompts dizem que ele nunca muda as regras.

## Consequências
- Com `TASK_VERIFY` vazio, a tarefa fica pronta só com os testes do agente; a tela avisa.
- Comandos de teste do projeto podem executar código do repositório. A proteção é a lista de comandos e a worktree, não um sandbox de sistema operacional.
- Cada tarefa usa espaço em disco até ser descartada ou ter o PR aberto.
