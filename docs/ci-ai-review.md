# Pré-review por IA no CI (opt-in) · AI pre-review in CI

> **Antes de ligar:** este workflow envia o diff e trechos do código do repositório ao provedor do modelo (Anthropic). Use só com aprovação da empresa e de quem responde por segurança e dados. *It sends code to the model provider: get company approval first.*

## O que faz

- Roda em cada PR que não é rascunho, vem do próprio repositório (forks não recebem o secret) e não tem a label `no-ai-review`.
- Posta **um** comentário marcado como pré-review por IA, atualizado a cada push: veredito sugerido, riscos, bloqueadores e achados por arquivo e linha.
- **Nunca** aprova, pede mudanças, faz push nem bloqueia o merge. A decisão é de quem revisa.
- PR acima de `max-lines` (padrão 2000 linhas) é pulado com um aviso sugerindo dividir.

## Como o agente fica isolado

| Camada | O que garante |
| --- | --- |
| Script (`ci/ai-review.mjs`) | Busca PR e diff com o `GITHUB_TOKEN` do job e é o único que posta. |
| Agente (`claude -p`) | Ferramentas só `Read`, `Grep`, `Glob`. Sem `Bash`, escrita, web ou MCP. |
| Ambiente do agente | Sem `GH_TOKEN`/`GITHUB_TOKEN`. Configurações do repositório (`.claude/`) são ignoradas (`--setting-sources ''`), porque são código do PR. |
| Prompt | Conteúdo do PR marcado como de terceiros, nunca como instrução. |
| Saída | Mascaramento de CPF, CNPJ, e-mail, cartão e tokens antes de postar. |
| Permissões do job | `contents: read`, `pull-requests: write`. |

## Como ligar num repositório

1. Crie o secret `ANTHROPIC_API_KEY` no repositório (ou na organização, restrito aos repositórios aprovados).
2. Copie [`docs/examples/ai-review-caller.yml`](examples/ai-review-caller.yml) para `.github/workflows/ai-review.yml`.
3. **Fixe a versão** em `uses: …/ai-review.yml@<tag-ou-sha>` e em `lead-deck-ref`, para o comportamento não mudar sem revisão.
4. Opcional: crie `.github/ai-review.md` com o guia de review do time (método, severidades, o que ignorar). Sem ele, o script usa `AGENTS.md` ou `CLAUDE.md`.

| Input | Padrão | Uso |
| --- | --- | --- |
| `model` | `sonnet` | Modelo do Claude Code |
| `max-lines` | `2000` | Limite de linhas alteradas |
| `language` | `pt-BR` | `pt-BR` ou `en` |
| `skip-label` | `no-ai-review` | Label que pula o PR |
| `lead-deck-ref` | `main` | Versão do script |

## Custo e qualidade

- O log do job mostra o custo estimado de cada review.
- Meça antes de espalhar: ligue em um repositório, julgue os achados por algumas semanas (a aba **Qualidade da IA** do painel faz isso para as reviews locais) e só então amplie.
- Para testar sem postar: `DRY_RUN=1 PR_NUMBER=12 REPO=org/app node ci/ai-review.mjs`.
