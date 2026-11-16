# ADR 0003 — Armazenamento: só as coleções próprias `painel_*`

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
Regra do projeto: somente leitura nas coleções da empresa e escrita em, no máximo, coleções próprias com o prefixo `painel_`. O Tech Lead aprovou três:
- `painel_resumos`
- `painel_sessoes`
- `painel_prs`, que substitui a coleção do painel de PRs anterior.

A descoberta (Fase 0) mostrou duas coisas:
- As mensagens do Discord (daily, tickets, menções) **não** estão no cluster acessível.
- As credenciais disponíveis (as do painel de PRs anterior) têm escrita e visibilidade de bancos de produção.

## Decisão
- A conexão usa `MONGO_URI` ou `MONGO_DATABASE_NAME/USER/PASS/CLUSTERNAME`, o mesmo formato do painel de PRs anterior. O banco do painel vem do `.env`.
- `PainelStore.collection()` só aceita nomes da allowlist `OWN_COLLECTIONS`. Qualquer outro nome lança erro, mesmo com cast de tipo. Isso é coberto por teste.
- Índices são criados **apenas** nas coleções `painel_*`. Nenhum índice nas coleções da empresa.
- O painel não lê nenhuma coleção da empresa no dia a dia: Discord vem do bot (ADR 0006) e GitHub da API (ADR 0007). A única exceção é a migração única, somente leitura, da coleção antiga de PRs (`readLegacyCollection`), cujo banco e nome vêm do `.env`.
- Uma quarta coleção exige aprovação do Tech Lead.

## Pendências
- **Recomendado:** criar um usuário Atlas com `readWrite` apenas no banco do painel, em vez de reaproveitar credenciais com acesso mais amplo.
