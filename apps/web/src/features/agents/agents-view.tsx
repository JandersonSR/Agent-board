import { useMutation } from '@tanstack/react-query';
import { Bot, Eraser, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dot, EmptyState, Pill } from '@/components/common';
import { useAgentSessionsContext } from '@/hooks/use-agent-sessions';
import { api } from '@/lib/api';
import { fmtCost, plural } from '@/lib/format';
import { usePref } from '@/lib/prefs';
import { SessionCard } from './session-card';
import { COLUMNS, groupByColumn, groupByTask } from './session-meta';

export function AgentsView({ editor, onNewTask }: { editor: string; onNewTask: () => void }) {
  const { sessions, flashed } = useAgentSessionsContext();
  const [layout, setLayout] = usePref<'board' | 'tasks'>('agents.layout', 'board');
  const clear = useMutation({
    mutationFn: () => api.post('/api/clear-ended'),
    onSuccess: () => toast.success('Sessões encerradas arquivadas'),
  });
  const ended = sessions.filter(s => s.state === 'ended').length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={layout} onValueChange={v => setLayout(v as 'board' | 'tasks')}>
          <TabsList>
            <TabsTrigger value="board">Quadro</TabsTrigger>
            <TabsTrigger value="tasks">Por tarefa</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto flex items-center gap-2">
          {ended > 0 && <Button size="sm" variant="ghost" disabled={clear.isPending} onClick={() => clear.mutate()}><Eraser /> Arquivar encerradas ({ended})</Button>}
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-xl border border-dashed">
          <EmptyState icon={Bot} title="Nenhuma sessão de agente"
            description={<>As sessões do Claude Code e do Cursor aparecem aqui assim que começam (hooks instalados com <code className="font-mono">npm run install-hooks</code>).</>}
            action={<Button size="sm" onClick={onNewTask}><Plus /> Nova tarefa</Button>} />
        </div>
      ) : layout === 'board' ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
          {(() => {
            const g = groupByColumn(sessions);
            return COLUMNS.map(c => (
              <section key={c.id} className="flex min-h-0 flex-col rounded-xl bg-muted/50 p-2" aria-label={c.title}>
                <h2 className="flex items-center gap-2 px-1.5 pb-2 pt-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <Dot tone={c.tone} pulse={c.id === 'needs_you' && g[c.id].length > 0} /> {c.title}
                  <Pill className="ml-auto" tone={g[c.id].length && c.id !== 'idle' ? c.tone : 'neutral'}>{g[c.id].length}</Pill>
                </h2>
                <div className="min-h-0 flex-1 space-y-2 overflow-auto p-0.5">
                  {g[c.id].length
                    ? g[c.id].map(s => <SessionCard key={s.id} session={s} editor={editor} flash={flashed.has(s.id)} />)
                    : <p className="px-2 py-6 text-center text-xs text-muted-foreground">{c.empty}</p>}
                </div>
              </section>
            ));
          })()}
        </div>
      ) : (
        <div className="space-y-5 overflow-auto">
          {groupByTask(sessions).map(g => (
            <section key={g.key}>
              <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
                {g.key}
                <span className="text-xs font-normal text-muted-foreground">{plural(g.list.length, 'sessão', 'sessões')} · {g.tools}{g.cost ? ` · ${fmtCost(g.cost)}` : ''}</span>
              </h2>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {g.list.map(s => <SessionCard key={s.id} session={s} editor={editor} flash={flashed.has(s.id)} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
