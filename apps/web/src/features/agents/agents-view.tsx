import { useMutation } from '@tanstack/react-query';
import { Bot, Eraser, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dot, EmptyState, Pill } from '@/components/common';
import { useAgentSessionsContext } from '@/hooks/use-agent-sessions';
import { api } from '@/lib/api';
import { fmtCost, plural } from '@/lib/format';
import { t } from '@/lib/i18n';
import { usePref } from '@/lib/prefs';
import { SessionCard } from './session-card';
import { COLUMNS, groupByColumn, groupByTask } from './session-meta';
import { BackgroundSessions, useBackgroundSessions } from './background-sessions';

type ToolFilter = 'all' | 'claude' | 'cursor';
const TOOL_LABEL: Record<Exclude<ToolFilter, 'all'>, string> = { claude: 'Claude Code', cursor: 'Cursor' };
const toolOf = (s: { tool?: 'claude' | 'cursor' }) => s.tool ?? 'claude';

export function AgentsView({ editor, onNewTask }: { editor: string; onNewTask: () => void }) {
  const { sessions: all, flashed } = useAgentSessionsContext();
  // Claude Code and Cursor apart: the chosen tool filters the board and the task view (Background is Claude Code only).
  const [tool, setTool] = usePref<ToolFilter>('agents.tool', 'all');
  const counts = { all: all.length, claude: all.filter(s => toolOf(s) === 'claude').length, cursor: all.filter(s => toolOf(s) === 'cursor').length };
  const sessions = tool === 'all' ? all : all.filter(s => toolOf(s) === tool);
  const [layout, setLayout] = usePref<'board' | 'tasks' | 'background'>('agents.layout', 'board');
  const bg = useBackgroundSessions().data;
  const bgBlocked = bg?.available ? bg.sessions.filter(s => s.state === 'blocked').length : 0;
  const clear = useMutation({
    mutationFn: () => api.post('/api/clear-ended'),
    onSuccess: () => toast.success(t('Ended sessions archived')),
  });
  const ended = all.filter(s => s.state === 'ended').length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={layout} onValueChange={v => setLayout(v as 'board' | 'tasks' | 'background')}>
          <TabsList>
            <TabsTrigger value="board">{t('Board')}</TabsTrigger>
            <TabsTrigger value="tasks">{t('By task')}</TabsTrigger>
            <TabsTrigger value="background">{t('Background')}{bgBlocked > 0 && <Pill tone="danger" className="ml-1.5">{bgBlocked}</Pill>}</TabsTrigger>
          </TabsList>
        </Tabs>
        {layout !== 'background' && (
          <Tabs value={tool} onValueChange={v => setTool(v as ToolFilter)}>
            <TabsList aria-label={t('Agent tool')}>
              <TabsTrigger value="all">{t('All')}<span className="ml-1.5 tabular-nums text-muted-foreground">{counts.all}</span></TabsTrigger>
              {(['claude', 'cursor'] as const).map(x => (
                <TabsTrigger key={x} value={x}>{TOOL_LABEL[x]}<span className="ml-1.5 tabular-nums text-muted-foreground">{counts[x]}</span></TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
        <div className="ml-auto flex items-center gap-2">
          {ended > 0 && <Button size="sm" variant="ghost" disabled={clear.isPending} onClick={() => clear.mutate()}><Eraser /> {t('Archive ended ({n})', { n: ended })}</Button>}
        </div>
      </div>

      {layout === 'background' ? <BackgroundSessions /> : sessions.length === 0 && all.length > 0 ? (
        <div className="rounded-xl border border-dashed">
          <EmptyState icon={Bot} title={t('No {tool} sessions', { tool: tool === 'all' ? '' : TOOL_LABEL[tool] })}
            description={tool === 'cursor' ? t('Cursor sessions show up after the Cursor hooks are installed (npm run install-cursor) and Cursor is restarted.') : t('Sessions of the other tool are in the All tab.')}
            action={<Button size="sm" variant="outline" onClick={() => setTool('all')}>{t('Show all')}</Button>} />
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border border-dashed">
          <EmptyState icon={Bot} title={t('No agent sessions')}
            description={<>{t('Claude Code and Cursor sessions show up here as soon as they start (hooks installed with')} <code className="font-mono">npm run install-hooks</code>).</>}
            action={<Button size="sm" onClick={onNewTask}><Plus /> {t('New task')}</Button>} />
        </div>
      ) : layout === 'board' ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
          {(() => {
            const g = groupByColumn(sessions);
            return COLUMNS.map(c => (
              <section key={c.id} className="flex min-h-0 flex-col rounded-xl bg-muted/50 p-2" aria-label={t(c.title)}>
                <h2 className="flex items-center gap-2 px-1.5 pb-2 pt-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <Dot tone={c.tone} pulse={c.id === 'needs_you' && g[c.id].length > 0} /> {t(c.title)}
                  <Pill className="ml-auto" tone={g[c.id].length && c.id !== 'idle' ? c.tone : 'neutral'}>{g[c.id].length}</Pill>
                </h2>
                <div className="min-h-0 flex-1 space-y-2 overflow-auto p-0.5">
                  {g[c.id].length
                    ? g[c.id].map(s => <SessionCard key={s.id} session={s} editor={editor} flash={flashed.has(s.id)} />)
                    : <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t(c.empty)}</p>}
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
                {g.key === 'No task' ? t('No task') : g.key}
                <span className="text-xs font-normal text-muted-foreground">{plural(g.list.length, 'session', 'sessions')} · {g.tools}{g.cost ? ` · ${fmtCost(g.cost)}` : ''}</span>
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
