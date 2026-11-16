// Tela "Hoje": os blocos do Tech Lead. Na Fase 2a só o resumo dos agentes tem dados;
// os demais mostram o estado real da integração de que dependem (não configurado / em breve).
import { Bot, CircleSlash, GitPullRequest, Inbox, ListChecks, MessagesSquare, PlayCircle, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BlockCard, Dot, Pill, type BlockStatus } from '@/components/common';
import { useAgentSessionsContext } from '@/hooks/use-agent-sessions';
import type { Health } from '@/lib/types';
import { ago } from '@/lib/format';
import { useHealth } from '../settings/settings-view';

function statusFor(health: Health | undefined, check: string, what: string, phase: string, description: string, goSettings: () => void): BlockStatus {
  if (!health) return { kind: 'loading' };
  const c = health.checks.find(x => x.id === check);
  if (!c || c.state === 'off') return { kind: 'not_configured', what, onConfigure: goSettings };
  return { kind: 'coming', phase, description };
}

export function OverviewView({ goTo }: { goTo: (view: 'agents' | 'settings') => void }) {
  const { sessions } = useAgentSessionsContext();
  const health = useHealth().data;
  const goSettings = () => goTo('settings');
  const needs = sessions.filter(s => s.state === 'needs_you');
  const review = sessions.filter(s => s.state === 'review');
  const working = sessions.filter(s => s.state === 'working');
  const attention = [...needs, ...review].sort((a, b) => a.updatedAt - b.updatedAt).slice(0, 5);

  return (
    <div className="grid auto-rows-[minmax(16rem,auto)] grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      <BlockCard icon={MessagesSquare} title="Daily do time"
        status={statusFor(health, 'discord', 'Discord', 'Fase 2b', 'Quem postou, bloqueios, confiança 1–2 e o que mudou desde ontem.', goSettings)} />
      <BlockCard icon={Inbox} title="Minha fila"
        status={statusFor(health, 'github', 'GitHub', 'Fase 2b', 'Bugs, tickets, tarefas e PRs que te mencionam ou estão atribuídos a você, por prioridade e idade.', goSettings)} />
      <BlockCard icon={CircleSlash} title="Bloqueios do time"
        status={statusFor(health, 'discord', 'Discord', 'Fase 2b', 'Quem está travado, há quanto tempo e em qual tarefa.', goSettings)} />
      <BlockCard icon={GitPullRequest} title="Reviews pendentes"
        status={statusFor(health, 'github', 'GitHub', 'Fase 2b', 'PRs aguardando seu review, do mais antigo ao mais novo, com tamanho e pré-review por agente.', goSettings)} />
      <BlockCard icon={Rocket} title="PRs e deploy"
        status={statusFor(health, 'mongo', 'MongoDB', 'Fase 2b', 'Fila → review → RCs → aprovações → merged, sincronizado do GitHub, sem cadastro manual.', goSettings)} />

      <BlockCard icon={Bot} title="Agentes ao vivo"
        count={needs.length + review.length || undefined} countTone={needs.length ? 'danger' : 'warning'}
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

      <BlockCard icon={PlayCircle} title="Sessões de resolução" className="lg:col-span-2 2xl:col-span-3"
        status={{ kind: 'coming', phase: 'Fase 3', description: '“Iniciar sessão de resolução” em qualquer item: prompt editável e mascarado, worktree isolada, log ao vivo, diff e PR rascunho só com o seu clique.' }} />
    </div>
  );
}
