# ADR 0004 — Mascaramento de dados pessoais antes de LLM, log e banco

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
O domínio é fintech de empréstimo. Mensagens de ticket e bug podem trazer CPF, renda, dados bancários e dados de clientes. A regra do projeto diz que esses dados nunca vão para logs, para prompts de LLM, nem para a tela sem necessidade.

## Decisão
- Existe um módulo único, `apps/server/src/privacy/mask.ts`, com regras ordenadas. Ele cobre:
  - segredos: tokens GitHub e Discord, Bearer, credenciais em URL, `senha=`;
  - e-mail, CNPJ, CPF, RG, cartão (só se passar no Luhn), telefone BR e CEP;
  - agência e conta (somente com rótulo);
  - renda/salário e valores em R$.
- **Preservados:** menções e canais do Discord (`<@id>`, `<#id>`) e o caminho das URLs (links de PR e issue). A query string das URLs é mascarada.
- Padrões extras vêm de `MASK_EXTRA_PATTERNS` no `.env`. Regex inválida é ignorada.
- **Onde é aplicado:**
  - todo texto que entra em prompt de LLM;
  - todo log de sessão gravado em `deck_runs`;
  - mensagens de erro devolvidas pela API;
  - textos persistidos em `deck_summaries`.
- O logger do Fastify não registra corpo, cabeçalhos nem query.
- Política: **na dúvida, mascara**. Um falso positivo, como um número de 11 dígitos que não é CPF, é aceitável. Um vazamento não é.

## Consequências
- Testes com valores **fictícios** cobrem cada tipo de dado, a preservação de links e menções, e os padrões extras.
- O resultado inclui contagens por tipo, para a UI mostrar "N dados mascarados" no preview do prompt.
