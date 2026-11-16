import { memo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle, Bot, Check, ChevronDown, Copy, FolderOpen, GitBranch, GitCompareArrows, MoreHorizontal, ShieldAlert,
  Terminal, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Mono, Pill, type Tone } from '@/components/common';
import { api } from '@/lib/api';
import { ago, fmtCost, fmtTok, plural } from '@/lib/format';
import type { AgentSession, Approval } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ReviewPanel } from './review-panel';
import { isStale } from './session-meta';

const enc = encodeURIComponent;

async function copy(text: string, label = 'Copiado') {
  try { await navigator.clipboard.writeText(text); toast.success(label, { description: text.length > 80 ? `${text.slice(0, 80)}…` : text }); }
  catch { toast.error('Não foi possível copiar', { description: text }); }
}

const stateTone: Record<string, Tone> = { needs_you: 'danger', review: 'warning', working: 'info', idle: 'neutral', ended: 'neutral' };

function ApprovalBox({ session, approval }: { session: AgentSession; approval: Approval }) {
  const [reason, setReason] = useState('');
  const [showDetail, setShowDetail] = useState(false);
  const decide = useMutation({
    mutationFn: (behavior: 'allow' | 'deny') =>
      api.post(`/api/sessions/${enc(session.id)}/decision`, {
        requestId: approval.requestId, behavior, ...(behavior === 'deny' && reason ? { message: reason } : {}),
      }),
    onSuccess: (_r, b) => toast.success(b === 'allow' ? 'Permitido' : 'Negado', { description: approval.summary }),
    onError: (e: Error) => toast.error('Resposta não enviada', { description: e.message }),
  });
  return (
    <div className="space-y-2 rounded-lg border border-danger/30 bg-danger-soft/60 p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-danger">
        <ShieldAlert className="size-3.5" /> Pedido de permissão · {ago(approval.at)}
      </div>
      <p className="font-mono text-[12px] leading-snug break-words">{approval.summary}</p>
      <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setShowDetail(v => !v)}>
        {showDetail ? 'Ocultar detalhes' : 'Ver detalhes'}
      </button>
      {showDetail && <pre className="max-h-40 overflow-auto rounded bg-background/70 p-2 font-mono text-[11px]">{approval.detail}</pre>}
      {approval.remote ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="xs" disabled={decide.isPending} onClick={() => decide.mutate('allow')}><Check /> Permitir</Button>
          <Button size="xs" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate('deny')}><X /> Negar</Button>
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Motivo (o agente lê)" maxLength={500}
            className="h-6 min-w-32 flex-1 bg-background/70 text-xs" aria-label="Motivo da negação" />
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">Responda no terminal: o painel não estava aberto quando o pedido chegou.</p>
      )}
    </div>
  );
}

export const SessionCard = memo(function SessionCard({ session: s, editor, flash }: { session: AgentSession; editor: string; flash: boolean }) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const dismiss = useMutation({
    mutationFn: () => api.post(`/api/sessions/${enc(s.id)}/dismiss`),
    onError: (e: Error) => toast.error('Não foi possível dispensar', { description: e.message }),
  });

  const stale = isStale(s);
  const title = s.title || s.task;
  const todos = s.todos ?? [];
  const done = todos.filter(t => t.status === 'completed').length;
  const current = todos.find(t => t.status === 'in_progress');
  const u = s.usage;
  const ctxPct = u?.contextMax ? Math.min(100, Math.round((u.context / u.contextMax) * 100)) : 0;
  const mode = s.mode && s.mode !== 'default' ? s.mode : null;
  const resumeCmd = s.tool === 'cursor' ? `cursor "${s.cwd}"` : `cd "${s.cwd}" && claude --resume ${s.id}`;

  return (
    <article
      className={cn(
        'group/card relative space-y-2.5 rounded-xl border bg-card p-3 shadow-xs transition-shadow hover:shadow-sm',
        s.state === 'needs_you' && 'border-danger/40',
        s.state === 'review' && 'border-warning/40',
        flash && 'animate-in fade-in-0 zoom-in-95 ring-2 ring-ring',
      )}
      aria-label={`${s.project ?? 'sessão'}: ${title ?? ''}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="truncate text-[13px] font-semibold">{s.project ?? '—'}</span>
        {s.taskId && <Pill tone="info"><Mono>{s.taskId}</Mono></Pill>}
        <Pill>{s.tool === 'cursor' ? 'Cursor' : 'Claude Code'}</Pill>
        {mode && <Pill tone={mode === 'bypassPermissions' ? 'danger' : 'neutral'}>{mode}</Pill>}
        <Tooltip>
          <TooltipTrigger asChild><span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">{ago(s.updatedAt)}</span></TooltipTrigger>
          <TooltipContent>Última atividade: {new Date(s.updatedAt).toLocaleString('pt-BR')}</TooltipContent>
        </Tooltip>
      </div>

      {s.branch && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <GitBranch className="size-3" /><Mono className="truncate text-[11px]">{s.branch}</Mono>
        </div>
      )}

      {title && <p className="line-clamp-2 text-[13px] leading-snug">{title}</p>}
      {s.title && s.task && <p className="line-clamp-1 text-xs text-muted-foreground" title={s.task}>{s.task}</p>}

      {s.message && (
        <p className={cn('rounded-md px-2 py-1.5 text-xs leading-snug', s.state === 'needs_you' || s.state === 'review' ? 'bg-warning-soft text-foreground' : 'bg-muted text-muted-foreground')}>
          {s.message}
        </p>
      )}

      {s.approvals?.map(a => <ApprovalBox key={a.requestId} session={s} approval={a} />)}

      {s.state === 'working' && s.lastTool && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Terminal className="size-3.5 shrink-0" /><Mono className="truncate text-[11px]">{s.lastTool}</Mono>
        </div>
      )}
      {stale && (
        <div className="flex items-center gap-1.5 rounded-md bg-warning-soft px-2 py-1 text-xs text-warning">
          <AlertTriangle className="size-3.5" /> Sem atividade há {ago(s.updatedAt)}. Travou?
        </div>
      )}
      {s.notice && <p className="rounded-md bg-info-soft px-2 py-1 text-xs text-info">{s.notice}</p>}

      {todos.length > 0 && (
        <Collapsible>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="tabular-nums">{done}/{todos.length} passos</span>
              {current && <span className="truncate font-medium text-foreground">{current.active || current.text}</span>}
              <CollapsibleTrigger asChild>
                <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label="Ver passos"><ChevronDown /></Button>
              </CollapsibleTrigger>
            </div>
            <Progress value={(done / todos.length) * 100} className="h-1" />
          </div>
          <CollapsibleContent>
            <ul className="mt-1.5 space-y-0.5 text-xs">
              {todos.map((t, i) => (
                <li key={i} className={cn('flex gap-1.5', t.status === 'completed' && 'text-muted-foreground line-through')}>
                  <span className="w-3 shrink-0">{t.status === 'in_progress' ? '▸' : t.status === 'completed' ? '✓' : '·'}</span>{t.text}
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}

      {u && u.turns > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
            <span className={cn(ctxPct >= 80 && 'font-medium text-warning')}>contexto {ctxPct}%</span>
            <span>{fmtTok(u.total)} tok · {fmtCost(u.cost)}</span>
            {u.model && <span className="ml-auto truncate">{u.model.replace(/^claude-/, '')}</span>}
          </div>
          <Progress value={ctxPct} className={cn('h-1', ctxPct >= 80 && '[&>*]:bg-warning')} />
        </div>
      )}

      {reviewOpen && <ReviewPanel session={s} editor={editor} />}

      <div className="flex items-center gap-1 pt-0.5">
        <div className="flex min-w-0 flex-1 flex-wrap gap-x-2 text-[11px] text-muted-foreground">
          <span>{plural(s.toolCount ?? 0, 'ação', 'ações')}</span>
          {!!s.files?.length && <span>{plural(s.files.length, 'arquivo', 'arquivos')}</span>}
          {!!s.subagents && <span><Bot className="mr-0.5 inline size-3" />{s.subagents}</span>}
          {!!s.compactions && <span>{plural(s.compactions, 'compactação', 'compactações')}</span>}
          {s.checkpoint && <span className="text-warning" title={s.checkpoint}>checkpoint</span>}
        </div>
        {s.cwd && (
          <Button size="xs" variant={reviewOpen ? 'secondary' : 'ghost'} onClick={() => setReviewOpen(v => !v)} aria-pressed={reviewOpen}>
            <GitCompareArrows /> {reviewOpen ? 'Ocultar' : 'Mudanças'}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label="Mais ações"><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {s.cwd && <DropdownMenuItem onSelect={() => void copy(resumeCmd, 'Comando de retomada copiado')}><Terminal /> {s.tool === 'cursor' ? 'Copiar "abrir no Cursor"' : 'Copiar retomada'}</DropdownMenuItem>}
            {s.cwd && <DropdownMenuItem onSelect={() => void copy(s.cwd!, 'Pasta copiada')}><FolderOpen /> Copiar pasta</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => void copy(s.id, 'ID copiado')}><Copy /> Copiar ID</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => dismiss.mutate()}><X /> Dispensar</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <span className="sr-only">Estado: {s.state}</span>
      <span aria-hidden className={cn('absolute top-3 -left-px h-5 w-0.5 rounded-r', {
        'bg-danger': stateTone[s.state] === 'danger', 'bg-warning': stateTone[s.state] === 'warning', 'bg-info': stateTone[s.state] === 'info',
      })} />
    </article>
  );
});
