# ADR 0006 — Discord via bot somente leitura

- **Status:** aceito (o bot ainda precisa ser criado)
- **Data:** 2026-11-16

## Contexto
A daily, os tickets, os bugs, os anúncios de PR e as menções chegam como mensagens no Discord.
- A descoberta (Fase 0) não encontrou essas mensagens no MongoDB acessível.
- A integração existente do backend com o Discord usa apenas **webhooks**, que só **enviam** mensagens. Webhook não lê histórico.

## Decisão
- Um bot próprio do painel, privado e não público, com permissões **apenas** de `View Channels` e `Read Message History`, mais o intent `Message Content`.
- Leitura pela API REST do Discord com `fetch`, sem discord.js e sem gateway, a cada `POLL_INTERVAL_MIN` (padrão 5 min) e pelo botão de atualizar.
- No `.env` (nunca no código): token, ID do servidor, canal da daily, canais observados (`rotulo:id`), o próprio ID e cargos para menções, e a lista do time (`id:nome`).
- **Enviar** mensagem ao Discord fica desligado. Só será ligado depois de o Tech Lead aprovar o canal (Fase 4), e sempre com clique e preview.

## Consequências
- Sem o bot, os blocos daily, fila (parte Discord) e bloqueios mostram "não configurado" com o guia de criação. Os blocos de GitHub funcionam.
- Quem tem "Gerenciar Servidor" precisa autorizar o bot no servidor.
