# ADR 0012 — Medir a qualidade da review por IA

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
As reviews por IA viravam review pendente no GitHub sem nenhuma medida de acerto. Sem medida, não dá para saber se uma mudança na skill de review melhorou ou piorou, nem se vale o custo.

## Decisão
- Cada achado de uma execução de review recebe um julgamento: **mantido**, **descartado** ou sem julgamento. Fica em `findingDecisions` na própria execução.
- Só os achados não descartados viram a review pendente.
- **Precisão** = mantidos ÷ julgados. Também mostramos a cobertura (julgados ÷ total) e o custo por achado mantido.
- Cada execução guarda `promptVersion` (constante da versão do prompt + hash da skill) e `promptEdited` (se o prompt foi editado na tela). Assim duas versões da skill podem ser comparadas.
- Os números saem por versão do prompt, severidade e repositório (`GET /api/quality`).

## Consequências
- A precisão só é confiável com julgamento. Abaixo de 50% de cobertura a tela avisa.
- Medimos precisão, não recall: achados que a IA deixou de apontar não aparecem aqui.
- Prompts editados à mão ficam marcados e podem distorcer a comparação entre versões.
