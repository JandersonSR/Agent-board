# ADR 0015 — CI do projeto e pré-review por IA reutilizável

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
O projeto não tinha CI, e o hook roda em Windows, macOS e Linux. Além disso, o time pode querer uma pré-review por IA nos PRs sem cada pessoa rodar o painel.

## Decisão
- **CI** (`.github/workflows/ci.yml`): typecheck, testes e build em Ubuntu, Windows e macOS com Node 22, e Ubuntu com Node 20 (versão mínima). Um job separado roda `npm audit` das dependências de produção.
- **Pré-review reutilizável** (`.github/workflows/ai-review.yml`, `workflow_call`), opt-in por repositório:
  - Só comenta, num único comentário atualizado. Nunca aprova nem pede mudanças.
  - O script busca PR e diff e é o único que fala com o GitHub. O agente só lê arquivos e não recebe o token do GitHub nem as configurações do repositório.
  - Pula rascunhos, forks, PRs grandes e PRs com a label de exclusão.
  - Exige um secret `ANTHROPIC_API_KEY` no repositório que chama.

## Consequências
- Ligar a pré-review envia código ao provedor do modelo: depende de aprovação da empresa, por repositório.
- Quem chama deve fixar a versão (tag ou SHA) para não receber mudanças sem revisão.
- Os julgamentos de qualidade (ADR 0012) cobrem só as reviews locais; a qualidade no CI é avaliada olhando os comentários.
