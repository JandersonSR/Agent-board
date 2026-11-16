// Tela "Hoje": tudo que o Tech Lead precisa ver num só lugar.
import { Bot, Flag, Landmark, ListChecks, PlayCircle, Server, ShieldAlert, Siren } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BlockCard, Dot, Pill } from '@/components/common';
import { useAgentSessionsContext } from '@/hooks/use-agent-sessions';
import { ago } from '@/lib/format';
import { BlockersBlock, DailyBlock, PrsBlock, QueueBlock, ReviewsBlock } from '../board/blocks';
import { useRuns } from '@/hooks/use-runs';
import { useStaffAlerts } from '@/hooks/use-staff';
import { RunStatusPill } from '../runs/runs-view';
import { TaskPhasePill } from '../runs/task-detail';
import { fmtCost } from '@/lib/format';
import { agentText, t } from '@/lib/i18n';

function RunsBlock({ goTo }: { goTo: (v: OverviewTarget, id?: string) => void }) {
  const q = useRuns();
  const items = (q.data?.items ?? []).slice(0, 6);
  return (
    <BlockCard icon={PlayCircle} title={t('Execuções de agentes')} className="lg:col-span-2 2xl:col-span-3 !min-h-0"
      count={q.data?.running || undefined} countTone="info"
      actions={<Button size="xs" variant="ghost" onClick={() => goTo('runs')}>{t('Abrir execuções')}</Button>}
      status={q.isLoading ? { kind: 'loading' } : items.length ? { kind: 'ready' } : { kind: 'coming', phase: t('primeira execução'), description: t('Use ✨ num PR em Reviews pendentes para uma review, ou a varinha numa issue de Minha fila para resolver a tarefa com um agente.') }}>
      <ul className="divide-y">
        {items.map(r => (
          <li key={r._id}>
            <button type="button" onClick={() => goTo('runs', r._id)} className="flex w-full items-center gap-2.5 px-3.5 py-[calc(var(--row-py)+0.25rem)] text-left hover:bg-muted/60">
              {r.kind === 'task' ? <TaskPhasePill phase={r.task?.phase} /> : <RunStatusPill status={r.status} />}
              <span className="min-w-0 flex-1 truncate text-[13px]">{r.title}</span>
              {r.result?.review && <span className="shrink-0 text-[11px] text-muted-foreground">{t('{n} achados · prod {ready}', { n: r.result.review.findings.length, ready: t(r.result.review.readyForProd ? 'SIM' : 'NÃO') })}</span>}
              <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">{r.usage ? fmtCost(r.usage.costUsd) : ''}</span>
              <span className="w-12 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">{ago(Date.parse(r.startedAt))}</span>
            </button>
          </li>
        ))}
      </ul>
    </BlockCard>
  );
}

export type OverviewTarget = 'agents' | 'settings' | 'deploy' | 'runs' | 'product' | 'infra' | 'incidents' | 'decisions';

function AgentsBlock({ goTo }: { goTo: (v: OverviewTarget) => void }) {
  const { sessions } = useAgentSessionsContext();
  const needs = sessions.filter(s => s.state === 'needs_you');
  const review = sessions.filter(s => s.state === 'review');
  const working = sessions.filter(s => s.state === 'working');
  const attention = [...needs, ...review].sort((a, b) => a.updatedAt - b.updatedAt).slice(0, 5);
  return (
    <BlockCard icon={Bot} title={t('Agentes ao vivo')} count={needs.length + review.length || undefined} countTone={needs.length ? 'danger' : 'warning'}
      actions={<Button size="xs" variant="ghost" onClick={() => goTo('agents')}>{t('Abrir quadro')}</Button>}>
      <div className="flex gap-4 border-b px-3.5 py-2.5 text-xs">
        <span className="flex items-center gap-1.5"><Dot tone="danger" pulse={needs.length > 0} /> <b className="tabular-nums">{needs.length}</b> {t('precisam de você')}</span>
        <span className="flex items-center gap-1.5"><Dot tone="warning" /> <b className="tabular-nums">{review.length}</b> {t('para revisar')}</span>
        <span className="flex items-center gap-1.5"><Dot tone="info" /> <b className="tabular-nums">{working.length}</b> {t('trabalhando')}</span>
      </div>
      {attention.length ? (
        <ul className="divide-y">
          {attention.map(s => (
            <li key={s.id}>
              <button type="button" onClick={() => goTo('agents')} className="flex w-full items-center gap-2 px-3.5 py-[calc(var(--row-py)+0.25rem)] text-left hover:bg-muted/60">
                <Dot tone={s.state === 'needs_you' ? 'danger' : 'warning'} />
                <span className="shrink-0 text-xs font-medium">{s.project}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{agentText(s.approvals?.[0]?.summary ?? s.message) || s.title || s.task}</span>
                {s.taskId && <Pill tone="info">{s.taskId}</Pill>}
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{ago(s.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 px-3.5 py-6 text-xs text-muted-foreground"><ListChecks className="size-4" /> {t('Nenhum agente esperando você.')}</p>
      )}
    </BlockCard>
  );
}

/** O que pede atenção de Staff: incidentes, ações atrasadas, postmortems, decisões paradas e etapas do produto. */
function StaffBlock({ goTo }: { goTo: (v: OverviewTarget) => void }) {
  const q = useStaffAlerts();
  const d = q.data;
  if (!d?.configured) return null;
  const inc = d.incidents!; const dec = d.decisions!;
  const rows: Array<{ icon: typeof Siren; text: string; tone: 'danger' | 'warning'; to: OverviewTarget }> = [];
  if (d.infra?.critical) rows.push({ icon: Server, text: t('{n} alerta(s) crítico(s) na infra', { n: d.infra.critical }), tone: 'danger', to: 'infra' });
  if (d.infra?.down) rows.push({ icon: Server, text: t('{n} recurso(s) fora do ar', { n: d.infra.down }), tone: 'danger', to: 'infra' });
  if (d.infra?.warning) rows.push({ icon: Server, text: t('{n} aviso(s) na infra', { n: d.infra.warning }), tone: 'warning', to: 'infra' });
  if (inc.open) rows.push({ icon: Siren, text: t('{n} incidente(s) aberto(s)', { n: inc.open }), tone: 'danger', to: 'incidents' });
  if (inc.overdueActions.length) rows.push({ icon: Siren, text: t('{n} ação(ões) de incidente atrasada(s)', { n: inc.overdueActions.length }), tone: 'warning', to: 'incidents' });
  if (inc.postmortemPending.length) rows.push({ icon: Siren, text: t('{n} postmortem(s) pendente(s)', { n: inc.postmortemPending.length }), tone: 'warning', to: 'incidents' });
  if (dec.overdue) rows.push({ icon: Landmark, text: t('{n} decisão(ões) com prazo vencido', { n: dec.overdue }), tone: 'danger', to: 'decisions' });
  if (dec.stale) rows.push({ icon: Landmark, text: t('{n} decisão(ões) parada(s) sem prazo', { n: dec.stale }), tone: 'warning', to: 'decisions' });
  for (const i of d.initiatives ?? []) {
    const parts = [i.late ? t('{n} atrasada(s)', { n: i.late }) : '', i.blocked ? t('{n} bloqueada(s)', { n: i.blocked }) : '', i.highRisks ? t('{n} risco(s) alto(s)', { n: i.highRisks }) : ''].filter(Boolean);
    if (parts.length) rows.push({ icon: Flag, text: `${i.name}: ${parts.join(' · ')}`, tone: i.late || i.blocked ? 'danger' : 'warning', to: 'product' });
  }
  return (
    <BlockCard icon={ShieldAlert} title={t('Atenção')} count={rows.length || undefined} countTone={rows.some(r => r.tone === 'danger') ? 'danger' : 'warning'} className="!min-h-0">
      {rows.length ? (
        <ul className="divide-y">
          {rows.map((r, i) => (
            <li key={i}>
              <button type="button" onClick={() => goTo(r.to)} className="flex w-full items-center gap-2.5 px-3.5 py-[calc(var(--row-py)+0.25rem)] text-left text-[13px] hover:bg-muted/60">
                <Dot tone={r.tone} /><r.icon className="size-3.5 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{r.text}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="flex items-center gap-2 px-3.5 py-6 text-xs text-muted-foreground"><ListChecks className="size-4" /> {t('Nada pedindo atenção: sem incidentes abertos, ações atrasadas ou decisões paradas.')}</p>}
    </BlockCard>
  );
}

export function OverviewView({ goTo }: { goTo: (view: OverviewTarget, id?: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3 [&>*]:max-h-[28rem] [&>*]:min-h-64">
      <DailyBlock goTo={goTo} />
      <BlockersBlock goTo={goTo} />
      <StaffBlock goTo={goTo} />
      <AgentsBlock goTo={goTo} />
      <QueueBlock goTo={goTo} className="2xl:col-span-2" />
      <ReviewsBlock goTo={goTo} />
      <PrsBlock goTo={goTo} className="lg:col-span-2 2xl:col-span-3" />
      <RunsBlock goTo={goTo} />
    </div>
  );
}
