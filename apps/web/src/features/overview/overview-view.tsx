// Tela "Hoje": tudo que o Tech Lead precisa ver num só lugar.
import { Bot, ListChecks, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BlockCard, Dot, Pill } from '@/components/common';
import { useAgentSessionsContext } from '@/hooks/use-agent-sessions';
import { ago } from '@/lib/format';
import { BlockersBlock, DailyBlock, PrsBlock, QueueBlock, ReviewsBlock } from '../board/blocks';

export type OverviewTarget = 'agents' | 'settings' | 'deploy';

function AgentsBlock({ goTo }: { goTo: (v: OverviewTarget) => void }) {
  const { sessions } = useAgentSessionsContext();
  const needs = sessions.filter(s => s.state === 'needs_you');
  const review = sessions.filter(s => s.state === 'review');
  const working = sessions.filter(s => s.state === 'working');
  const attention = [...needs, ...review].sort((a, b) => a.updatedAt - b.updatedAt).slice(0, 5);
  return (
    <BlockCard icon={Bot} title="Agentes ao vivo" count={needs.length + review.length || undefined} countTone={needs.length ? 'danger' : 'warning'}
      actions={<Button size="xs" variant="ghost" onClick={() => goTo('agents')}>Abrir quadro</Button>}>
      <div className="flex gap-4 border-b px-3.5 py-2.5 text-xs">
        <span className="flex items-center gap-1.5"><Dot tone="danger" pulse={needs.length > 0} /> <b className="tabular-nums">{needs.length}</b> precisam de você</span>
        <span className="flex items-center gap-1.5"><Dot tone="warning" /> <b className="tabular-nums">{review.length}</b> para revisar</span>
        <span className="flex items-center gap-1.5"><Dot tone="info" /> <b className="tabular-nums">{working.length}</b> trabalhando</span>
      </div>
      {attention.length ? (
        <ul className="divide-y">
          {attention.map(s => (
            <li key={s.id}>
              <button type="button" onClick={() => goTo('agents')} className="flex w-full items-center gap-2 px-3.5 py-[calc(var(--row-py)+0.25rem)] text-left hover:bg-muted/60">
                <Dot tone={s.state === 'needs_you' ? 'danger' : 'warning'} />
                <span className="shrink-0 text-xs font-medium">{s.project}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{s.approvals?.[0]?.summary ?? s.message ?? s.title ?? s.task}</span>
                {s.taskId && <Pill tone="info">{s.taskId}</Pill>}
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{ago(s.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 px-3.5 py-6 text-xs text-muted-foreground"><ListChecks className="size-4" /> Nenhum agente esperando você.</p>
      )}
    </BlockCard>
  );
}

export function OverviewView({ goTo }: { goTo: (view: OverviewTarget) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3 [&>*]:max-h-[28rem] [&>*]:min-h-64">
      <DailyBlock goTo={goTo} />
      <BlockersBlock goTo={goTo} />
      <AgentsBlock goTo={goTo} />
      <QueueBlock goTo={goTo} className="2xl:col-span-2" />
      <ReviewsBlock goTo={goTo} />
      <PrsBlock goTo={goTo} className="lg:col-span-2 2xl:col-span-3" />
      <BlockCard icon={PlayCircle} title="Sessões de resolução" className="lg:col-span-2 2xl:col-span-3 !min-h-0"
        status={{ kind: 'coming', phase: 'Fase 3', description: '“Iniciar sessão de resolução” em qualquer item: prompt editável e mascarado, worktree isolada, log ao vivo, diff e PR rascunho só com o seu clique.' }} />
    </div>
  );
}
