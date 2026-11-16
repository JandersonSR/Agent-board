// Peças visuais reutilizadas em toda a tela: tom semântico, estados vazios e o cartão de bloco.
import type { ComponentType, ReactNode } from 'react';
import { AlertTriangle, Clock3, PlugZap, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type Tone = 'danger' | 'warning' | 'success' | 'info' | 'neutral';

const toneClasses: Record<Tone, string> = {
  danger: 'bg-danger-soft text-danger ring-danger/20',
  warning: 'bg-warning-soft text-warning ring-warning/25',
  success: 'bg-success-soft text-success ring-success/20',
  info: 'bg-info-soft text-info ring-info/20',
  neutral: 'bg-muted text-muted-foreground ring-border',
};
const dotClasses: Record<Tone, string> = {
  danger: 'bg-danger', warning: 'bg-warning', success: 'bg-success', info: 'bg-info', neutral: 'bg-muted-foreground/60',
};

export function Pill({ tone = 'neutral', className, children, title }: { tone?: Tone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap', toneClasses[tone], className)}>
      {children}
    </span>
  );
}

export function Dot({ tone = 'neutral', pulse = false, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)} aria-hidden>
      {pulse && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', dotClasses[tone])} />}
      <span className={cn('relative inline-flex size-2 rounded-full', dotClasses[tone])} />
    </span>
  );
}

export function Mono({ className, children, title }: { className?: string; children: ReactNode; title?: string }) {
  return <span title={title} className={cn('font-mono text-[12px] tracking-tight', className)}>{children}</span>;
}

export function EmptyState({ icon: Icon, title, description, action, className }: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-8 text-center', className)}>
      <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon className="size-4" /></div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export type BlockStatus =
  | { kind: 'ready' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string; retry?: () => void }
  | { kind: 'not_configured'; what: string; onConfigure?: () => void }
  | { kind: 'coming'; phase: string; description: string };

export function BlockCard({ icon: Icon, title, count, countTone = 'neutral', actions, status = { kind: 'ready' }, className, bodyClassName, children }: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  count?: number | string;
  countTone?: Tone;
  actions?: ReactNode;
  status?: BlockStatus;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}) {
  return (
    <section className={cn('flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs', className)} aria-label={title}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3.5">
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        {count !== undefined && <Pill tone={countTone}>{count}</Pill>}
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </header>
      <div className={cn('min-h-0 flex-1 overflow-auto', bodyClassName)}>
        {status.kind === 'ready' && children}
        {status.kind === 'loading' && (
          <div className="space-y-2.5 p-3.5">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-9 w-full" style={{ opacity: 1 - i * 0.18 }} />)}
          </div>
        )}
        {status.kind === 'error' && (
          <EmptyState icon={AlertTriangle} title={t('Não foi possível carregar')} description={status.message}
            action={status.retry && <Button size="sm" variant="outline" onClick={status.retry}><RefreshCw /> {t('Tentar de novo')}</Button>} />
        )}
        {status.kind === 'not_configured' && (
          <EmptyState icon={PlugZap} title={t('{what} não configurado', { what: status.what })} description={t('Preencha as variáveis no .env e reinicie o servidor. O passo a passo está em Configuração.')}
            action={status.onConfigure && <Button size="sm" variant="outline" onClick={status.onConfigure}>{t('Abrir Configuração')}</Button>} />
        )}
        {status.kind === 'coming' && (
          <EmptyState icon={Clock3} title={t('Chega na {phase}', { phase: status.phase })} description={status.description} />
        )}
      </div>
    </section>
  );
}
