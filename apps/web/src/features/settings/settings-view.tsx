import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed, Gauge, Loader2, MinusCircle, RefreshCw, TriangleAlert, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Mono } from '@/components/common';
import type { Density, ThemePref } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import type { CheckState, Health } from '@/lib/types';
import { cn } from '@/lib/utils';

export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/api/health'), refetchInterval: 60_000 });

const stateIcon: Record<CheckState, { icon: typeof CheckCircle2; cls: string; label: string }> = {
  ok: { icon: CheckCircle2, cls: 'text-success', label: 'OK' },
  warn: { icon: TriangleAlert, cls: 'text-warning', label: 'Atenção' },
  off: { icon: MinusCircle, cls: 'text-muted-foreground', label: 'Não configurado' },
  error: { icon: XCircle, cls: 'text-danger', label: 'Erro' },
};

export interface PrefsProps {
  theme: ThemePref; setTheme: (t: ThemePref) => void;
  density: Density; setDensity: (d: Density) => void;
  editor: string; setEditor: (e: string) => void;
  notify: boolean; setNotify: (n: boolean) => void;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div><Label className="text-sm">{label}</Label>{hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}</div>
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
      <section className="rounded-xl border bg-card shadow-xs">
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Integrações</h2>
          <span className="text-xs text-muted-foreground">segredos nunca são exibidos</span>
          <Button size="xs" variant="ghost" className="ml-auto" disabled={refreshing}
            onClick={() => void qc.fetchQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/api/health?fresh=1') })}>
            {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Verificar de novo
          </Button>
        </header>
        <ul className="divide-y">
          {health.isLoading && <li className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Verificando…</li>}
          {health.data?.checks.map(c => {
            const s = stateIcon[c.state];
            return (
              <li key={c.id} className="flex gap-3 px-4 py-3">
                <s.icon className={cn('mt-0.5 size-4 shrink-0', s.cls)} aria-label={s.label} />
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

      <div className="space-y-4">
        <section className="rounded-xl border bg-card px-4 shadow-xs">
          <h2 className="border-b py-3 text-sm font-semibold">Preferências</h2>
          <div className="divide-y">
            <Row label="Tema">
              <Select value={p.theme} onValueChange={v => p.setTheme(v as ThemePref)}>
                <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="system">Sistema</SelectItem><SelectItem value="light">Claro</SelectItem><SelectItem value="dark">Escuro</SelectItem></SelectContent>
              </Select>
            </Row>
            <Row label="Densidade" hint="Compacta mostra mais linhas por bloco.">
              <Select value={p.density} onValueChange={v => p.setDensity(v as Density)}>
                <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="comfortable">Confortável</SelectItem><SelectItem value="compact">Compacta</SelectItem></SelectContent>
              </Select>
            </Row>
            <Row label="Editor" hint="Usado nos links de arquivo do diff.">
              <Select value={p.editor} onValueChange={p.setEditor}>
                <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="cursor">Cursor</SelectItem><SelectItem value="vscode">VS Code</SelectItem></SelectContent>
              </Select>
            </Row>
            <Row label="Notificações no desktop" hint="Quando um agente precisa de você ou fica pronto para revisar.">
              <Switch checked={p.notify} onCheckedChange={v => void requestNotify(v)} aria-label="Notificações no desktop" />
            </Row>
          </div>
        </section>

        {health.data && (
          <section className="rounded-xl border bg-card px-4 py-3 shadow-xs">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Gauge className="size-4 text-muted-foreground" /> Limites de custo</h2>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Sessões simultâneas</dt><dd className="text-right tabular-nums">{health.data.limits.maxConcurrent}</dd>
              <dt className="text-muted-foreground">Tempo máximo por sessão</dt><dd className="text-right tabular-nums">{health.data.limits.timeoutMin} min</dd>
              <dt className="text-muted-foreground">Execuções por dia</dt><dd className="text-right tabular-nums">{health.data.limits.maxDailyRuns}</dd>
              <dt className="text-muted-foreground">Atualização automática</dt><dd className="text-right tabular-nums">{health.data.limits.pollIntervalMin} min</dd>
            </dl>
            <p className="mt-2 text-[11px] text-muted-foreground">Altere no <Mono className="text-[11px]">.env</Mono> e reinicie o servidor.</p>
          </section>
        )}

        <section className="rounded-xl border bg-card px-4 py-3 shadow-xs">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><CircleDashed className="size-4 text-muted-foreground" /> Bot do Discord (somente leitura)</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
            <li>Developer Portal → <b className="text-foreground">New Application</b>.</li>
            <li>Aba Bot: <b className="text-foreground">Reset Token</b> → <Mono className="text-[11px]">DISCORD_BOT_TOKEN</Mono>; ative <b className="text-foreground">Message Content Intent</b>; desative Public Bot.</li>
            <li>OAuth2 → URL Generator: scope <Mono className="text-[11px]">bot</Mono>, permissões <b className="text-foreground">só</b> View Channels + Read Message History.</li>
            <li>Um admin abre a URL e adiciona o bot ao servidor.</li>
            <li>Modo desenvolvedor → Copiar ID dos canais e do seu usuário → <Mono className="text-[11px]">.env</Mono>.</li>
          </ol>
        </section>
      </div>
    </div>
  );
}
