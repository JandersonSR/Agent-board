# Roadmap

What comes next, roughly in order. Open an issue to discuss any item or suggest another. *Português abaixo.*

## Next (v0.5)
- **Weekly report** generated from the board: deliveries, DORA, risks, incidents and open decisions, ready to send to leadership.
- **Configurable daily format** (the template the daily parser reads).
- **`TLDECK_*` environment variables**, with the `AGENT_BOARD_*` names still accepted.

## Later
- **Inbound events:** an optional listener (separate port, signed requests) for Slack, email and webhooks from Datadog, Grafana or your own servers.
- **SLOs and error budgets** from a metrics source (Prometheus, Grafana or Datadog), linked to incidents.
- **Dependency health** across repositories (vulnerabilities and outdated packages).
- **Prebuilt package** (`npx tldeck`) and a Docker image.
- **Team mode:** a read-only shared view of team flow and DORA, without anyone's personal queue.

## Not planned
- A hosted service. TLDeck stays local-first.
- Ranking people. Metrics measure the process, never individuals.

---

## Português

**Próximo (v0.5):** relatório semanal gerado pelo painel; formato da daily configurável; variáveis `TLDECK_*` aceitando as antigas.

**Depois:** eventos de entrada (Slack, e-mail e webhooks do Datadog, Grafana ou dos seus servidores, em porta separada e com assinatura); SLOs e orçamento de erro a partir de Prometheus, Grafana ou Datadog; saúde das dependências; pacote pronto (`npx tldeck`) e imagem Docker; modo time (visão compartilhada só leitura).

**Fora dos planos:** serviço hospedado e ranking de pessoas.
