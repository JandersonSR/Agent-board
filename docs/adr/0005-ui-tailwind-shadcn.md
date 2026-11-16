# ADR 0005 — UI: Tailwind + shadcn/ui (Radix), TanStack Query, cmdk e sonner

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
O Tech Lead pediu uma interface profissional, com UX e UI no mínimo muito boas. A tela fica aberta o dia todo e precisa de três coisas:
- **densidade de informação:** muitos blocos de dados na mesma tela;
- **ações rápidas:** teclado e command palette;
- **estados bem resolvidos:** carregamento, vazio, erro e não configurado.

## Decisão
- **Tailwind CSS 4** com tokens de tema em variáveis CSS, tema claro e escuro.
- **shadcn/ui:** os componentes são copiados para `apps/web/src/components/ui`, o código fica no repo e é construído sobre Radix, que é acessível por padrão.
- **lucide-react** para ícones, **@tanstack/react-query** para cache, polling e estados de requisição, **cmdk** para a command palette (Ctrl+K) e **sonner** para toasts.
- Direção visual inspirada em Linear, Vercel e GitHub:
  - Inter, com JetBrains Mono para IDs, diffs e logs;
  - cor reservada para significado: vermelho para bloqueio, âmbar para atenção, verde para concluído.

## Alternativas
- **Mantine:** uma lib só e rápida de montar, mas o visual é mais genérico e há menos controle fino.

## Consequências
- Os componentes shadcn podem ser editados livremente. Atualizações deles são manuais.
- Acessibilidade: contraste AA, foco visível e navegação completa por teclado são critério de aceite de cada bloco.
