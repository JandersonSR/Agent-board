# ADR 0018 — Registro de decisões do time

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto
O time começou a escrever decisões, mas elas ficam espalhadas entre docs e repositórios, e decisões abertas não têm dono nem prazo. Uma decisão parada vira débito sem ninguém perceber.

## Decisão
- Coleção própria `deck_decisions` com tipo (ADR, design doc, RFC), status (proposta, em discussão, decidida, rejeitada, substituída), dono, quem decide, link, contexto, decisão e **prazo para decidir**.
- Avisos: abertas com prazo vencido, vencendo em 7 dias e paradas há mais de 3 semanas sem prazo.
- **Importação de ADRs** dos clones locais (`REPOS` e `REPOS_ROOT`): lê só arquivos `.md` em pastas conhecidas (`docs/adr`, `docs/decisions`…), ignora links simbólicos e arquivos grandes, e extrai título, status e data. Nada é escrito nos repositórios.
- Em ADRs importados, título e status vêm do arquivo (o repositório é a fonte da verdade); dono, prazo e contexto são editados no painel.

## Consequências
- O status de um ADR importado só muda no arquivo; a próxima importação atualiza o painel.
- Formatos de ADR muito diferentes podem ser lidos como "proposta" quando o status não é reconhecido.
