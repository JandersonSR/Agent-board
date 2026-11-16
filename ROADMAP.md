# Roadmap

What comes next, roughly in order. Open an issue to discuss any item or suggest another. *Português abaixo.*

## Next (v0.5)
- **Weekly report** generated from the board: deliveries, DORA, risks, incidents and open decisions, ready to send to leadership.
- **Pluggable team specifics:** deploy statuses, the daily format, Discord and GitHub Projects as adapters, so other teams can plug Slack, Jira or Linear.
- **English in the code:** identifiers and comments migrate to English, keeping the interface in both languages.
- **`LEAD_DECK_*` environment variables**, with the `AGENT_BOARD_*` names still accepted.

## Later
- **Inbound events:** an optional listener (separate port, signed requests) for Slack, email and webhooks from Datadog, Grafana or your own servers.
- **SLOs and error budgets** from a metrics source (Prometheus, Grafana or Datadog), linked to incidents.
- **Dependency health** across repositories (vulnerabilities and outdated packages).
- **Prebuilt package** (`npx lead-deck`) and a Docker image.
- **Team mode:** a read-only shared view of team flow and DORA, without anyone's personal queue.

## Not planned
- A hosted service. Lead Deck stays local-first.
- Ranking people. Metrics measure the process, never individuals.

---

## Português

**Próximo (v0.5):** relatório semanal gerado pelo painel; partes específicas do time como adaptadores (Slack, Jira, Linear); código em inglês com a interface nos dois idiomas; variáveis `LEAD_DECK_*` aceitando as antigas.

**Depois:** eventos de entrada (Slack, e-mail e webhooks do Datadog, Grafana ou dos seus servidores, em porta separada e com assinatura); SLOs e orçamento de erro a partir de Prometheus, Grafana ou Datadog; saúde das dependências; pacote pronto (`npx lead-deck`) e imagem Docker; modo time (visão compartilhada só leitura).

**Fora dos planos:** serviço hospedado e ranking de pessoas.
