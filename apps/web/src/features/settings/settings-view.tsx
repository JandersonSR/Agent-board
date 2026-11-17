import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed, Gauge, Loader2, MinusCircle, RefreshCw, TriangleAlert, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Mono } from '@/components/common';
import type { Density, ThemePref } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { getLang, k, LANGS, t, type Lang } from '@/lib/i18n';
import type { CheckState, Health } from '@/lib/types';
import { cn } from '@/lib/utils';
import { FeatMapsPanel } from './featmaps-panel';

// The server returns the integration texts in the language asked for.
export const useHealth = () => useQuery({ queryKey: ['health', getLang()], queryFn: () => api.get<Health>(`/api/health?lang=${getLang()}`), refetchInterval: 60_000 });

// label is a translation key (English text).
const stateIcon: Record<CheckState, { icon: typeof CheckCircle2; cls: string; label: string }> = {
  ok: { icon: CheckCircle2, cls: 'text-success', label: k('OK') },
  warn: { icon: TriangleAlert, cls: 'text-warning', label: k('Attention') },
  off: { icon: MinusCircle, cls: 'text-muted-foreground', label: k('Not configured') },
  error: { icon: XCircle, cls: 'text-danger', label: k('Error') },
};

export interface PrefsProps {
  theme: ThemePref; setTheme: (t: ThemePref) => void;
  density: Density; setDensity: (d: Density) => void;
  lang: Lang; setLang: (l: Lang) => void;
  editor: string; setEditor: (e: string) => void;
  notify: boolean; setNotify: (n: boolean) => void;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div><Label className="text-sm">{t(label)}</Label>{hint && <p className="mt-0.5 text-xs text-muted-foreground">{t(hint)}</p>}</div>
      {children}
    </div>
  );
}

export function SettingsView(p: PrefsProps) {
  const qc = useQueryClient();
  const health = useHealth();
  const refreshing = health.isFetching;

  const requestNotify = async (on: boolean) => {
    if (on && 'Notification' in window && Notification.permission !== 'granted') {
      const r = await Notification.requestPermission();
      if (r !== 'granted') return;
    }
    p.setNotify(on);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <div className="space-y-4">
      <section className="rounded-xl border bg-card shadow-xs">
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{t('Integrations')}</h2>
          <span className="text-xs text-muted-foreground">{t('secrets are never shown')}</span>
          <Button size="xs" variant="ghost" className="ml-auto" disabled={refreshing}
            onClick={() => void qc.fetchQuery({ queryKey: ['health', getLang()], queryFn: () => api.get<Health>(`/api/health?fresh=1&lang=${getLang()}`) })}>
            {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('Check again')}
          </Button>
        </header>
        <ul className="divide-y">
          {health.isLoading && <li className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t('Checking…')}</li>}
          {health.data?.checks.map(c => {
            const s = stateIcon[c.state];
            return (
              <li key={c.id} className="flex gap-3 px-4 py-3">
                <s.icon className={cn('mt-0.5 size-4 shrink-0', s.cls)} aria-label={t(s.label)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="text-xs text-muted-foreground">{c.detail}</p>
                  {c.hint && c.state !== 'ok' && <p className="mt-1 text-xs text-foreground/80">→ {c.hint}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <FeatMapsPanel />
      </div>

      <div className="space-y-4">
        <section className="rounded-xl border bg-card px-4 shadow-xs">
          <h2 className="border-b py-3 text-sm font-semibold">{t('Preferences')}</h2>
          <div className="divide-y">
            <Row label={k('Language')} hint={k('Portuguese or English. Shortcut: L.')}>
              <Select value={p.lang} onValueChange={v => p.setLang(v as Lang)}>
                <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>{LANGS.map(l => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}</SelectContent>
              </Select>
            </Row>
            <Row label={k('Theme')}>
              <Select value={p.theme} onValueChange={v => p.setTheme(v as ThemePref)}>
                <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="system">{t('System')}</SelectItem><SelectItem value="light">{t('Light')}</SelectItem><SelectItem value="dark">{t('Dark')}</SelectItem></SelectContent>
              </Select>
            </Row>
            <Row label={k('Density')} hint={k('Compact shows more rows per block.')}>
              <Select value={p.density} onValueChange={v => p.setDensity(v as Density)}>
                <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="comfortable">{t('Comfortable')}</SelectItem><SelectItem value="compact">{t('Compact')}</SelectItem></SelectContent>
              </Select>
            </Row>
            <Row label={k('Editor')} hint={k('Used for file links in the diff.')}>
              <Select value={p.editor} onValueChange={p.setEditor}>
                <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="cursor">Cursor</SelectItem><SelectItem value="vscode">VS Code</SelectItem></SelectContent>
              </Select>
            </Row>
            <Row label={k('Desktop notifications')} hint={k('When an agent needs you or is ready for review.')}>
              <Switch checked={p.notify} onCheckedChange={v => void requestNotify(v)} aria-label={t('Desktop notifications')} />
            </Row>
          </div>
        </section>

        {health.data && (
          <section className="rounded-xl border bg-card px-4 py-3 shadow-xs">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Gauge className="size-4 text-muted-foreground" /> {t('Cost limits')}</h2>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">{t('Concurrent sessions')}</dt><dd className="text-right tabular-nums">{health.data.limits.maxConcurrent}</dd>
              <dt className="text-muted-foreground">{t('Max time per session')}</dt><dd className="text-right tabular-nums">{health.data.limits.timeoutMin} min</dd>
              <dt className="text-muted-foreground">{t('Runs per day')}</dt><dd className="text-right tabular-nums">{health.data.limits.maxDailyRuns}</dd>
              <dt className="text-muted-foreground">{t('Auto refresh')}</dt><dd className="text-right tabular-nums">{health.data.limits.pollIntervalMin} min</dd>
            </dl>
            <p className="mt-2 text-[11px] text-muted-foreground">{t('Change it in')} <Mono className="text-[11px]">.env</Mono> {t('and restart the server.')}</p>
          </section>
        )}

        <section className="rounded-xl border bg-card px-4 py-3 shadow-xs">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><CircleDashed className="size-4 text-muted-foreground" /> {t('Discord bot (read-only)')}</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
            <li>Developer Portal → <b className="text-foreground">New Application</b>.</li>
            <li>{t('Bot tab:')} <b className="text-foreground">Reset Token</b> → <Mono className="text-[11px]">DISCORD_BOT_TOKEN</Mono>; {t('turn on')} <b className="text-foreground">Message Content Intent</b>; {t('turn off Public Bot.')}</li>
            <li>OAuth2 → URL Generator: scope <Mono className="text-[11px]">bot</Mono>, {t('permissions')} <b className="text-foreground">{t('only')}</b> View Channels + Read Message History.</li>
            <li>{t('An admin opens the URL and adds the bot to the server.')}</li>
            <li>{t('Developer mode → Copy the channel IDs and your user ID →')} <Mono className="text-[11px]">.env</Mono>.</li>
          </ol>
        </section>

        <section className="rounded-xl border bg-card px-4 py-3 shadow-xs">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><CircleDashed className="size-4 text-muted-foreground" /> {t('Slack app (read-only)')}</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
            <li>api.slack.com/apps → <b className="text-foreground">Create New App</b> {t('in your own workspace (an internal app).')}</li>
            <li>{t('OAuth & Permissions → bot scopes')} <b className="text-foreground">{t('only')}</b> <Mono className="text-[11px]">channels:history groups:history users:read usergroups:read</Mono>.</li>
            <li>{t('Install to the workspace →')} Bot User OAuth Token → <Mono className="text-[11px]">SLACK_BOT_TOKEN</Mono>.</li>
            <li>{t('Invite the app to the daily channel and to the watched channels (/invite @app).')}</li>
            <li>{t('Channel IDs (channel details) and your member ID (profile → Copy member ID) →')} <Mono className="text-[11px]">.env</Mono>.</li>
          </ol>
        </section>

        <section className="rounded-xl border bg-card px-4 py-3 shadow-xs">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><CircleDashed className="size-4 text-muted-foreground" /> {t('Jira and Linear (read-only)')}</h2>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
            <li><b className="text-foreground">Jira:</b> {t('an API token from an account with read access')} (id.atlassian.com → Security) → <Mono className="text-[11px]">JIRA_BASE_URL JIRA_EMAIL JIRA_API_TOKEN</Mono>.</li>
            <li><b className="text-foreground">Linear:</b> Settings → API → {t('personal API key')} → <Mono className="text-[11px]">LINEAR_API_KEY</Mono>.</li>
            <li>{t('Your queue shows the issues assigned to you. With the project keys (JIRA_PROJECT_KEYS, LINEAR_TEAM_KEYS), PRs that mention a key in the title, branch or body are grouped under that issue in PRs and deploys.')}</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
