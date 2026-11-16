import { useState, type ComponentType } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import {
  BarChart3, Bot, Sparkles, Command as CommandIcon, Keyboard, Languages, LayoutDashboard, Loader2, Monitor, Moon, Plus, RefreshCw, Rocket, Settings, Sun,
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
import { useBoardStatus, useSyncNow } from '@/hooks/use-board';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useThemeAndDensity, type ThemePref } from '@/hooks/use-theme';
import { usePref } from '@/lib/prefs';
import { applyLang, getLang, k, t, type Lang } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { AgentsView } from '@/features/agents/agents-view';
import { DeployView } from '@/features/board/deploy-view';
import { RunsView } from '@/features/runs/runs-view';
import { ago } from '@/lib/format';
import { LaunchDialog } from '@/features/agents/launch-dialog';
import { MetricsView } from '@/features/metrics/metrics-view';
import { OverviewView } from '@/features/overview/overview-view';
import { SettingsView } from '@/features/settings/settings-view';

// label, subtitle e as descrições dos atalhos são chaves de tradução (texto em português).
type View = 'overview' | 'agents' | 'deploy' | 'runs' | 'metrics' | 'settings';

const NAV: Array<{ id: View; label: string; icon: ComponentType<{ className?: string }>; keys: string; subtitle: string }> = [
  { id: 'overview', label: k('Hoje'), icon: LayoutDashboard, keys: 'G H', subtitle: k('Time, fila, reviews e bloqueios num só lugar') },
  { id: 'agents', label: k('Agentes'), icon: Bot, keys: 'G A', subtitle: k('Sessões do Claude Code e do Cursor ao vivo') },
  { id: 'deploy', label: k('PRs e deploy'), icon: Rocket, keys: 'G D', subtitle: k('Do review ao merge, por issue, sem cadastro manual') },
  { id: 'runs', label: k('Execuções'), icon: Sparkles, keys: 'G E', subtitle: k('Reviews e tarefas feitas por agentes, com log e resultado') },
  { id: 'metrics', label: k('Métricas'), icon: BarChart3, keys: 'G M', subtitle: k('Agentes, fluxo do time e qualidade da IA') },
  { id: 'settings', label: k('Configuração'), icon: Settings, keys: 'G C', subtitle: k('Integrações, limites e preferências') },
];

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl K', k('Paleta de comandos')], ['G H', k('Ir para Hoje')], ['G A', k('Ir para Agentes')], ['G D', k('Ir para PRs e deploy')], ['G E', k('Ir para Execuções')], ['G M', k('Ir para Métricas')],
  ['G C', k('Ir para Configuração')], ['N', k('Nova tarefa de agente')], ['R', k('Sincronizar agora (GitHub/Discord)')], ['T', k('Alternar tema')], ['L', k('Mudar idioma (português / inglês)')], ['?', k('Mostrar atalhos')],
];

const THEME_NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;
const THEME_LABEL: Record<ThemePref, string> = { system: k('sistema'), light: k('claro'), dark: k('escuro') };

export function App() {
  const qc = useQueryClient();
  const { theme, setTheme, density, setDensity } = useThemeAndDensity();
  const [editor, setEditor] = usePref<string>('editor', 'cursor');
  const [notifyPref, setNotifyPref] = usePref<'on' | 'off'>('notify', 'off');
  const [view, setView] = usePref<View>('view', 'overview');
  const [lang, setLang] = usePref<Lang>('lang', getLang());
  applyLang(lang); // antes de renderizar os filhos: t() e os formatadores leem o idioma atual
  const toggleLang = () => setLang(lang === 'en' ? 'pt-BR' : 'en');
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [launch, setLaunch] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const goTo = (v: View, id?: string) => { if (id) setRunId(id); setView(v); };

  const live = useAgentSessionsStream(notifyPref === 'on');
  const needs = live.sessions.filter(s => s.state === 'needs_you').length;
  const review = live.sessions.filter(s => s.state === 'review').length;
  document.title = needs + review ? `(${needs + review}) Agent Board` : 'Agent Board';

  const syncNow = useSyncNow();
  const status = useBoardStatus().data?.sources;
  const syncing = syncNow.isPending || !!(status && Object.values(status).some(s => s.running));
  const lastSync = status ? Object.values(status).map(s => s.lastSync).filter((x): x is string => !!x).sort().pop() : undefined;
  const refresh = () => { if (!syncNow.isPending) syncNow.mutate(); void qc.invalidateQueries({ queryKey: ['metrics'] }); };
  const cycleTheme = () => setTheme(THEME_NEXT[theme]);

  useHotkeys({
    'mod+k': () => setPalette(v => !v),
    'g h': () => setView('overview'), 'g a': () => setView('agents'), 'g d': () => setView('deploy'), 'g e': () => setView('runs'), 'g m': () => setView('metrics'), 'g c': () => setView('settings'),
    n: () => setLaunch(true), r: refresh, t: cycleTheme, l: toggleLang, '?': () => setHelp(true),
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
              <p className="text-[11px] text-muted-foreground">{t('painel do Tech Lead')}</p>
            </div>
          </div>
          <nav className="flex-1 space-y-0.5 px-2 py-2" aria-label={t('Navegação principal')}>
            {NAV.map(n => {
              const badge = n.id === 'agents' && needs + review > 0 ? needs + review : 0;
              return (
                <button key={n.id} type="button" onClick={() => setView(n.id)} aria-current={view === n.id ? 'page' : undefined}
                  className={cn('group flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors',
                    view === n.id ? 'bg-background font-medium text-foreground shadow-xs ring-1 ring-border' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
                  <n.icon className="size-4" />
                  {t(n.label)}
                  {badge > 0 && <Pill tone={needs ? 'danger' : 'warning'} className="ml-auto">{badge}</Pill>}
                  {!badge && <span className="ml-auto hidden font-mono text-[10px] text-muted-foreground/70 group-hover:inline">{n.keys}</span>}
                </button>
              );
            })}
          </nav>
          <div className="space-y-2 border-t p-3">
            <Button variant="outline" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => setPalette(true)}>
              <CommandIcon /> {t('Comandos')} <Kbd className="ml-auto">Ctrl K</Kbd>
            </Button>
            <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
              <Dot tone={live.conn === 'live' ? 'success' : 'warning'} pulse={live.conn !== 'live'} />
              {live.conn === 'live' ? t('ao vivo · 127.0.0.1') : live.conn === 'connecting' ? t('conectando…') : t('reconectando…')}
            </div>
          </div>
        </aside>

        {/* Conteúdo */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4 md:px-6">
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-semibold tracking-tight">{t(current.label)}</h1>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">{t(current.subtitle)}</p>
            </div>
            <nav className="ml-2 flex gap-1 md:hidden" aria-label={t('Navegação')}>
              {NAV.map(n => (
                <Button key={n.id} size="icon-sm" variant={view === n.id ? 'secondary' : 'ghost'} onClick={() => setView(n.id)} aria-label={t(n.label)}><n.icon /></Button>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-1">
              <Tooltip><TooltipTrigger asChild>
                <Button size="sm" variant="ghost" onClick={refresh} disabled={syncNow.isPending} aria-label={t('Sincronizar agora')} className="text-muted-foreground">
                  {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  <span className="hidden text-xs lg:inline">{syncing ? t('sincronizando…') : lastSync ? t('há {time}', { time: ago(Date.parse(lastSync)) }) : t('sincronizar')}</span>
                </Button>
              </TooltipTrigger><TooltipContent>{t('Sincronizar GitHub e Discord agora')} <Kbd>R</Kbd></TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost" onClick={cycleTheme} aria-label={t('Tema: {theme}', { theme: t(THEME_LABEL[theme]) })}><ThemeIcon /></Button>
              </TooltipTrigger><TooltipContent>{t('Tema: {theme}', { theme: t(THEME_LABEL[theme]) })} <Kbd>T</Kbd></TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <Button size="sm" variant="ghost" onClick={toggleLang} aria-label={t('Idioma: {lang}', { lang: lang === 'en' ? 'English' : 'Português' })} className="px-2 text-xs text-muted-foreground">
                  <Languages /> {lang === 'en' ? 'EN' : 'PT'}
                </Button>
              </TooltipTrigger><TooltipContent>{t('Mudar idioma (português / inglês)')} <Kbd>L</Kbd></TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost" onClick={() => setHelp(true)} aria-label={t('Atalhos')}><Keyboard /></Button>
              </TooltipTrigger><TooltipContent>{t('Atalhos')} <Kbd>?</Kbd></TooltipContent></Tooltip>
              <Button size="sm" className="ml-1" onClick={() => setLaunch(true)}><Plus /> <span className="hidden sm:inline">{t('Nova tarefa')}</span></Button>
            </div>
          </header>

          <main key={lang} className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
            {view === 'overview' && <OverviewView goTo={goTo} />}
            {view === 'runs' && <RunsView selected={runId} onSelect={setRunId} />}
            {view === 'agents' && <AgentsView editor={editor} onNewTask={() => setLaunch(true)} />}
            {view === 'deploy' && <DeployView />}
            {view === 'metrics' && <MetricsView />}
            {view === 'settings' && (
              <SettingsView theme={theme} setTheme={setTheme} density={density} setDensity={setDensity}
                lang={lang} setLang={setLang} editor={editor} setEditor={setEditor} notify={notifyPref === 'on'} setNotify={v => setNotifyPref(v ? 'on' : 'off')} />
            )}
          </main>
        </div>
      </div>

      <CommandDialog open={palette} onOpenChange={setPalette} title={t('Paleta de comandos')} description={t('Navegue e execute ações')}>
        <CommandInput placeholder={t('Buscar sessão, tela ou ação…')} />
        <CommandList>
          <CommandEmpty>{t('Nada encontrado.')}</CommandEmpty>
          <CommandGroup heading={t('Ações')}>
            <CommandItem onSelect={run(() => setLaunch(true))}><Plus /> {t('Nova tarefa de agente')}<CommandShortcut>N</CommandShortcut></CommandItem>
            <CommandItem onSelect={run(refresh)}><RefreshCw /> {t('Sincronizar agora')}<CommandShortcut>R</CommandShortcut></CommandItem>
            <CommandItem onSelect={run(cycleTheme)}><ThemeIcon /> {t('Alternar tema')}<CommandShortcut>T</CommandShortcut></CommandItem>
            <CommandItem onSelect={run(toggleLang)}><Languages /> {t('Mudar idioma (português / inglês)')}<CommandShortcut>L</CommandShortcut></CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading={t('Ir para')}>
            {NAV.map(n => <CommandItem key={n.id} onSelect={run(() => setView(n.id))}><n.icon /> {t(n.label)}<CommandShortcut>{n.keys}</CommandShortcut></CommandItem>)}
          </CommandGroup>
          {live.sessions.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={t('Sessões de agentes')}>
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
            <DialogTitle>{t('Atalhos de teclado')}</DialogTitle>
            <DialogDescription>{t('Funcionam em qualquer tela, fora de campos de texto.')}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
            {SHORTCUTS.map(([k, d]) => (
              <div key={k} className="contents">
                <dt className="flex gap-1">{k.split(' ').map(p => <Kbd key={p}>{p}</Kbd>)}</dt>
                <dd className="text-muted-foreground">{t(d)}</dd>
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
