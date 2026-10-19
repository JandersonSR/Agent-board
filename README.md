# Agent Board

Painel local para acompanhar várias sessões do Claude Code e do Cursor em paralelo sem entrar em cada uma.
Os agentes avisam o painel por hooks; você só abre uma sessão quando ela está em **Precisa de você** ou **Pronto para revisar**.

Sem dependências: só Node 18 ou mais novo. Funciona em Windows, macOS e Linux.

## Instalação (2 minutos)

```bash
# 1. Coloque a pasta onde quiser (ex.: ~/tools/agent-board) e entre nela
cd agent-board

# 2. Instale os hooks no Claude Code (faz backup do settings.json e preserva hooks existentes)
npm run install-hooks

# 3. Suba o painel e abra http://localhost:7777
npm start
```

Sessões abertas **depois** da instalação aparecem sozinhas. Sessões que já estavam abertas entram no próximo prompt.

Para remover: `npm run uninstall-hooks`.

### Cursor

```bash
npm run install-cursor     # grava em ~/.cursor/hooks.json; reinicie o Cursor depois
npm run uninstall-cursor   # remove
```

As sessões do Cursor aparecem no mesmo painel, com o selo **Cursor**. Diferenças:

- O Cursor não tem um evento de "esperando sua aprovação", então os cards dele vão de **Trabalhando** direto para **Pronto para revisar**. Um agente parado esperando aprovação aparece como **Travou?** depois de 10 minutos.
- O botão copia `cursor "<pasta>"`, que abre o projeto, porque o Cursor não retoma uma conversa pelo terminal.
- A última mensagem vem do evento `afterAgentResponse`.

## Colunas

| Coluna | Quando o card vai para ela |
| --- | --- |
| Precisa de você | O agente pediu permissão ou fez uma pergunta (`Notification`) |
| Pronto para revisar | O agente terminou o turno (`Stop`); mostra a última mensagem dele |
| Trabalhando | Você mandou um prompt ou ele está usando ferramentas; mostra a última ação |
| Ociosas e encerradas | Sessão aberta sem prompt, ou encerrada |

Nas colunas de ação, quem espera há mais tempo aparece primeiro. Um card em "Trabalhando" sem atividade há 10 minutos ganha o aviso **Travou?**.

Cada card mostra pasta, branch, a tarefa (primeiro prompt), arquivos alterados e um botão **Copiar retomada**, que copia `cd "<pasta>" && claude --resume <id>`.

## Avisos

- **No navegador:** clique em "Ativar avisos do navegador". O título da aba mostra quantos agentes esperam você.
- **No celular (opcional):** instale o app ntfy, assine um tópico difícil de adivinhar e defina a variável antes de abrir o Claude Code:

  ```bash
  export AGENT_BOARD_NTFY=https://ntfy.sh/meu-topico-secreto-8f3k   # Windows: setx AGENT_BOARD_NTFY ...
  ```

  A notificação leva só pasta, branch e estado, nunca código ou prompt.

## Configuração

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `AGENT_BOARD_DIR` | `~/.agent-board/sessions` | Onde ficam os estados das sessões |
| `AGENT_BOARD_PORT` | `7777` | Porta do painel |
| `AGENT_BOARD_NTFY` | vazio | URL do tópico ntfy para push no celular |

## Segurança

- O servidor escuta só em `127.0.0.1` e recusa POST de outras origens.
- O estado guarda caminhos, prompts resumidos e a última mensagem do agente; fica só na sua máquina.
- O hook nunca bloqueia o agente: qualquer erro é ignorado e ele sai em menos de 2 s.

## Como funciona

```
Claude Code ──hook (stdin JSON)──▶ hook.js ──grava──▶ ~/.agent-board/sessions/<id>.json
                                                              │ fs.watch
navegador ◀──────── SSE ──────── server.js ◀──────────────────┘
```

Próximos passos possíveis: botão para abrir o terminal na sessão, filtro por projeto, histórico de tempo por tarefa, e uma visão de time (cada dev publica o próprio estado).
