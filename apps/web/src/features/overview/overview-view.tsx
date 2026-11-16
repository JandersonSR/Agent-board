// Tela "Hoje": tudo que o Tech Lead precisa ver num só lugar.
import { Bot, ListChecks, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BlockCard, Dot, Pill } from '@/components/common';
import { useAgentSessionsContext } from '@/hooks/use-agent-sessions';
import { ago } from '@/lib/format';
import { BlockersBlock, DailyBlock, PrsBlock, QueueBlock, ReviewsBlock } from '../board/blocks';
import { useRuns } from '@/hooks/use-runs';
import { RunStatusPill } from '../runs/runs-view';
import { fmtCost } from '@/lib/format';
import { agentText, t } from '@/lib/i18n';

function RunsBlock({ goTo }: { goTo: (v: OverviewTarget, id?: string) => void }) {
  const q = useRuns();
  const items = (q.data?.items ?? []).slice(0, 6);
  return (
    <BlockCard icon={PlayCircle} title={t('Execuções de agentes')} className="lg:col-span-2 2xl:col-span-3 !min-h-0"
      count={q.data?.running || undefined} countTone="info"
      actions={<Button size="xs" variant="ghost" onClick={() => goTo('runs')}>{t('Abrir execuções')}</Button>}
      status={q.isLoading ? { kind: 'loading' } : items.length ? { kind: 'ready' } : { kind: 'coming', phase: t('primeira execução'), description: t('Use ✨ num PR em Reviews pendentes para pedir uma review ao Claude. Tarefas (até o PR) chegam na sequência.') }}>
      <ul className="divide-y">
        {items.map(r => (
          <li key={r._id}>
            <button type="button" onClick={() => goTo('runs', r._id)} className="flex w-full items-center gap-2.5 px-3.5 py-[calc(var(--row-py)+0.25rem)] text-left hover:bg-muted/60">
              <RunStatusPill status={r.status} />
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

export type OverviewTarget = 'agents' | 'settings' | 'deploy' | 'runs';

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

export function OverviewView({ goTo }: { goTo: (view: OverviewTarget, id?: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3 [&>*]:max-h-[28rem] [&>*]:min-h-64">
      <DailyBlock goTo={goTo} />
      <BlockersBlock goTo={goTo} />
      <AgentsBlock goTo={goTo} />
      <QueueBlock goTo={goTo} className="2xl:col-span-2" />
      <ReviewsBlock goTo={goTo} />
      <PrsBlock goTo={goTo} className="lg:col-span-2 2xl:col-span-3" />
      <RunsBlock goTo={goTo} />
    </div>
  );
}
