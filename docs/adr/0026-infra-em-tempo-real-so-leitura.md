# ADR 0026 — Infra em tempo real, só leitura

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
O Tech Lead precisa saber na hora quando um servidor ou app de produção cai ou fica sobrecarregado, ligar isso ao deploy que pode ter causado o problema e registrar o incidente sem retrabalho. O DORA usava as datas de deploy das issues, que são aproximadas. Ferramentas de incidentes (incident.io, PagerDuty) e de observabilidade fazem isso, mas são pagas e ficam fora do painel.

## Decisão
- **Ler, por polling, as APIs dos provedores** (DigitalOcean, Heroku, Azure Resource Health e Azure Monitor, Grafana Alerting) a cada `INFRA_POLL_SEC` segundos, com tokens **só de leitura**. Nada é exposto para a internet e nada na infraestrutura é alterado.
- Os provedores ficam atrás de uma interface (`InfraProvider.poll`) que devolve recursos, alertas e deploys; um `tracker` puro transforma leituras sucessivas em eventos (alerta disparado ou resolvido, mudança de estado, deploy) e calcula alertas por limite sustentado (CPU e memória), já que o DigitalOcean não expõe os alertas que dispara.
- **Uma leitura que falhou nunca resolve alertas** e mantém o último estado conhecido.
- Eventos ficam em `painel_eventos` (chave única, gravação idempotente). Os textos que vêm dos provedores passam pelo mascaramento de dados pessoais.
- **Incidente automático** só para alerta crítico de recurso de produção (`INFRA_PROD_RE`), no máximo 5 por hora; a resolução do alerta marca o incidente como **mitigado** — resolver e escrever o postmortem continua com a pessoa.
- **Possível causa:** deploy bem-sucedido do mesmo recurso até 60 minutos antes do alerta. É uma pista, não uma conclusão.
- O DORA passa a usar os deploys reais de produção quando existem, e o tempo de recuperação conta até a mitigação.

## Alternativas
- **Receber webhooks** (Datadog, Grafana, Slack): resposta mais rápida, mas exige expor uma porta ou túnel e validar assinaturas. Fica para uma etapa seguinte, opcional e em porta separada.
- **Integrar com uma ferramenta de incidentes paga:** fora do objetivo de ser local e gratuito.

## Consequências
- A detecção tem atraso de até um intervalo de leitura (60 s por padrão) mais o tempo sustentado (5 min) nos alertas por limite.
- Os limites de requisição dos provedores entram na conta: Heroku até 50 apps, DigitalOcean 3 chamadas de métrica por droplet por leitura.
- O modo demonstração traz uma infraestrutura fictícia com alertas, deploys e incidentes abertos pela regra.
