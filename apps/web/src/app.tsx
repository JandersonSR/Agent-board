import { useState, type ComponentType } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import {
  BarChart3, Bot, Command as CommandIcon, Keyboard, LayoutDashboard, Monitor, Moon, Plus, RefreshCw, Settings, Sun,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dot, Pill } from '@/components/common';
import { AgentSessionsContext, useAgentSessionsStream } from '@/hooks/use-agent-sessions';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useThemeAndDensity, type ThemePref } from '@/hooks/use-theme';
import { usePref } from '@/lib/prefs';
import { cn } from '@/lib/utils';
import { AgentsView } from '@/features/agents/agents-view';
import { LaunchDialog } from '@/features/agents/launch-dialog';
import { MetricsView } from '@/features/metrics/metrics-view';
import { OverviewView } from '@/features/overview/overview-view';
import { SettingsView } from '@/features/settings/settings-view';

type View = 'overview' | 'agents' | 'metrics' | 'settings';

const NAV: Array<{ id: View; label: string; icon: ComponentType<{ className?: string }>; keys: string; subtitle: string }> = [
  { id: 'overview', label: 'Hoje', icon: LayoutDashboard, keys: 'G H', subtitle: 'Time, fila, reviews e bloqueios num só lugar' },
  { id: 'agents', label: 'Agentes', icon: Bot, keys: 'G A', subtitle: 'Sessões do Claude Code e do Cursor ao vivo' },
  { id: 'metrics', label: 'Métricas', icon: BarChart3, keys: 'G M', subtitle: 'Tempo, espera e custo dos agentes' },
  { id: 'settings', label: 'Configuração', icon: Settings, keys: 'G C', subtitle: 'Integrações, limites e preferências' },
];

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl K', 'Paleta de comandos'], ['G H', 'Ir para Hoje'], ['G A', 'Ir para Agentes'], ['G M', 'Ir para Métricas'],
  ['G C', 'Ir para Configuração'], ['N', 'Nova tarefa de agente'], ['R', 'Atualizar dados'], ['T', 'Alternar tema'], ['?', 'Mostrar atalhos'],
];

const THEME_NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;

export function App() {
  const qc = useQueryClient();
  const { theme, setTheme, density, setDensity } = useThemeAndDensity();
  const [editor, setEditor] = usePref<string>('editor', 'cursor');
  const [notifyPref, setNotifyPref] = usePref<'on' | 'off'>('notify', 'off');
  const [view, setView] = usePref<View>('view', 'overview');
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [launch, setLaunch] = useState(false);

  const live = useAgentSessionsStream(notifyPref === 'on');
  const needs = live.sessions.filter(s => s.state === 'needs_you').length;
  const review = live.sessions.filter(s => s.state === 'review').length;
  document.title = needs + review ? `(${needs + review}) Agent Board` : 'Agent Board';

  const refresh = () => void qc.invalidateQueries();
  const cycleTheme = () => setTheme(THEME_NEXT[theme]);

  useHotkeys({
    'mod+k': () => setPalette(v => !v),
    'g h': () => setView('overview'), 'g a': () => setView('agents'), 'g m': () => setView('metrics'), 'g c': () => setView('settings'),
    n: () => setLaunch(true), r: refresh, t: cycleTheme, '?': () => setHelp(true),
  });

  const run = (fn: () => void) => () => { setPalette(false); fn(); };
  const current = NAV.find(n => n.id === view) ?? NAV[0]!;
  const ThemeIcon = THEME_ICON[theme];

  return (
    <AgentSessionsContext.Provider value={live}>
      <div className="flex h-dvh overflow-hidden">
        {/* Sidebar */}
        <aside className="hidden w-56 shrink-0 flex-col border-r bg-muted/30 md:flex">
          <div className="flex h-14 items-center gap-2 px-4">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Bot className="size-4" /></div>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight">Agent Board</p>
              <p className="text-[11px] text-muted-foreground">painel do Tech Lead</p>
            </div>
          </div>
          <nav className="flex-1 space-y-0.5 px-2 py-2" aria-label="Navegação principal">
            {NAV.map(n => {
              const badge = n.id === 'agents' && needs + review > 0 ? needs + review : 0;
              return (
                <button key={n.id} type="button" onClick={() => setView(n.id)} aria-current={view === n.id ? 'page' : undefined}
                  className={cn('group flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors',
                    view === n.id ? 'bg-background font-medium text-foreground shadow-xs ring-1 ring-border' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
                  <n.icon className="size-4" />
                  {n.label}
                  {badge > 0 && <Pill tone={needs ? 'danger' : 'warning'} className="ml-auto">{badge}</Pill>}
                  {!badge && <span className="ml-auto hidden font-mono text-[10px] text-muted-foreground/70 group-hover:inline">{n.keys}</span>}
                </button>
              );
            })}
          </nav>
          <div className="space-y-2 border-t p-3">
            <Button variant="outline" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => setPalette(true)}>
              <CommandIcon /> Comandos <Kbd className="ml-auto">Ctrl K</Kbd>
            </Button>
            <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
              <Dot tone={live.conn === 'live' ? 'success' : 'warning'} pulse={live.conn !== 'live'} />
              {live.conn === 'live' ? 'ao vivo · 127.0.0.1' : live.conn === 'connecting' ? 'conectando…' : 'reconectando…'}
            </div>
          </div>
        </aside>

        {/* Conteúdo */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4 md:px-6">
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-semibold tracking-tight">{current.label}</h1>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">{current.subtitle}</p>
            </div>
            <nav className="ml-2 flex gap-1 md:hidden" aria-label="Navegação">
              {NAV.map(n => (
                <Button key={n.id} size="icon-sm" variant={view === n.id ? 'secondary' : 'ghost'} onClick={() => setView(n.id)} aria-label={n.label}><n.icon /></Button>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-1">
              <Tooltip><TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost" onClick={refresh} aria-label="Atualizar"><RefreshCw /></Button>
              </TooltipTrigger><TooltipContent>Atualizar <Kbd>R</Kbd></TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost" onClick={cycleTheme} aria-label={`Tema: ${theme}`}><ThemeIcon /></Button>
              </TooltipTrigger><TooltipContent>Tema: {theme === 'system' ? 'sistema' : theme === 'light' ? 'claro' : 'escuro'} <Kbd>T</Kbd></TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost" onClick={() => setHelp(true)} aria-label="Atalhos"><Keyboard /></Button>
              </TooltipTrigger><TooltipContent>Atalhos <Kbd>?</Kbd></TooltipContent></Tooltip>
              <Button size="sm" className="ml-1" onClick={() => setLaunch(true)}><Plus /> <span className="hidden sm:inline">Nova tarefa</span></Button>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
            {view === 'overview' && <OverviewView goTo={setView} />}
            {view === 'agents' && <AgentsView editor={editor} onNewTask={() => setLaunch(true)} />}
            {view === 'metrics' && <MetricsView />}
            {view === 'settings' && (
              <SettingsView theme={theme} setTheme={setTheme} density={density} setDensity={setDensity}
                editor={editor} setEditor={setEditor} notify={notifyPref === 'on'} setNotify={v => setNotifyPref(v ? 'on' : 'off')} />
            )}
          </main>
        </div>
      </div>

      <CommandDialog open={palette} onOpenChange={setPalette} title="Paleta de comandos" description="Navegue e execute ações">
        <CommandInput placeholder="Buscar sessão, tela ou ação…" />
        <CommandList>
          <CommandEmpty>Nada encontrado.</CommandEmpty>
          <CommandGroup heading="Ações">
            <CommandItem onSelect={run(() => setLaunch(true))}><Plus /> Nova tarefa de agente<CommandShortcut>N</CommandShortcut></CommandItem>
            <CommandItem onSelect={run(refresh)}><RefreshCw /> Atualizar dados<CommandShortcut>R</CommandShortcut></CommandItem>
            <CommandItem onSelect={run(cycleTheme)}><ThemeIcon /> Alternar tema<CommandShortcut>T</CommandShortcut></CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Ir para">
            {NAV.map(n => <CommandItem key={n.id} onSelect={run(() => setView(n.id))}><n.icon /> {n.label}<CommandShortcut>{n.keys}</CommandShortcut></CommandItem>)}
          </CommandGroup>
          {live.sessions.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Sessões de agentes">
                {live.sessions.slice(0, 20).map(s => (
                  <CommandItem key={s.id} value={`${s.project} ${s.taskId ?? ''} ${s.title ?? s.task ?? ''} ${s.id}`} onSelect={run(() => setView('agents'))}>
                    <Dot tone={s.state === 'needs_you' ? 'danger' : s.state === 'review' ? 'warning' : s.state === 'working' ? 'info' : 'neutral'} />
                    <span className="font-medium">{s.project}</span>
                    <span className="truncate text-muted-foreground">{s.title ?? s.task}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>

      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Atalhos de teclado</DialogTitle>
            <DialogDescription>Funcionam em qualquer tela, fora de campos de texto.</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
            {SHORTCUTS.map(([k, d]) => (
              <div key={k} className="contents">
                <dt className="flex gap-1">{k.split(' ').map(p => <Kbd key={p}>{p}</Kbd>)}</dt>
                <dd className="text-muted-foreground">{d}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>

      <LaunchDialog open={launch} onOpenChange={setLaunch} />
      <Toaster position="bottom-right" richColors closeButton theme={theme} />
    </AgentSessionsContext.Provider>
  );
}
