# ADR 0021 — Conjunto fixo para medir o que a review por IA deixa passar

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
A precisão (ADR 0012) mostra quanto do que a IA aponta é útil, mas não o que ela deixa passar. Sem isso, uma mudança na skill de review pode ficar mais "educada" e pior ao mesmo tempo.

## Decisão
- Coleção própria `painel_avaliacoes` com casos: um PR (pode ser antigo) e a lista de problemas esperados (arquivo, linha opcional e palavras-chave). Os casos ficam no banco, **fora do repositório público**.
- Um esperado conta como encontrado quando um achado está no mesmo arquivo e tem uma das palavras-chave, ou fica a até 10 linhas da linha informada. Cada achado cobre um esperado só.
- **Recall** por versão do prompt, usando a execução concluída mais recente de cada caso, além de achados extras por caso e custo.
- "Rodar todos" usa a review normal, um caso de cada vez, respeitando os limites de custo. Execuções de avaliação ficam marcadas, não contam na precisão e nunca viram review no GitHub.

## Consequências
- O casamento por palavra-chave é simples e pode errar para os dois lados; vale revisar os casos que mudam de resultado entre versões.
- Cada rodada custa uma execução de review por caso.
