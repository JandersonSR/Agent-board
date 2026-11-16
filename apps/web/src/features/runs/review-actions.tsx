// Ações de review por LLM num PR: em segundo plano (com prévia do prompt), terminal ou Cursor.
import { useState } from 'react';
import { Bot, Loader2, MousePointerClick, ShieldCheck, Sparkles, SquareTerminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { Mono, Pill } from '@/components/common';
import { t } from '@/lib/i18n';
import { useOpenReviewCursor, useOpenReviewTerminal, useReviewPreview, useStartReview } from '@/hooks/use-runs';

export function ReviewActions({ url, title, onStarted }: { url: string; title: string; onStarted?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const preview = useReviewPreview();
  const start = useStartReview(id => { setOpen(false); onStarted?.(id); });
  const terminal = useOpenReviewTerminal();
  const cursor = useOpenReviewCursor();

  const openPreview = () => {
    setOpen(true);
    setPrompt('');
    preview.mutate({ url, title }, { onSuccess: d => setPrompt(d.prompt) });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-xs" variant="ghost" aria-label={t('Review por IA de {title}', { title })} onClick={e => e.stopPropagation()}><Sparkles /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60" onClick={e => e.stopPropagation()}>
          <DropdownMenuLabel className="text-xs">{t('Review por IA')}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={openPreview}><Bot /> {t('Revisar com Claude (segundo plano)')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => terminal.mutate(url)}><SquareTerminal /> {t('Abrir no terminal (Claude)')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => cursor.mutate(url)}><MousePointerClick /> {t('Abrir no Cursor')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <p className="px-2 pb-1 text-[11px] text-muted-foreground">{t('Nada é postado no GitHub sem o seu clique.')}</p>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Bot className="size-4" /> {t('Review com Claude')}</DialogTitle>
            <DialogDescription>
              <Mono>{url.replace('https://github.com/', '')}</Mono> · {t('o agente só lê o PR (gh pr view/diff) e o feat-map; não posta nada.')}
            </DialogDescription>
          </DialogHeader>
          {preview.isPending ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t('Montando o prompt (skill + features do RAG)…')}</div>
          ) : preview.error ? (
            <p className="text-sm text-danger">{(preview.error as Error).message}</p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <ShieldCheck className="size-3.5 text-success" />
                <span>{preview.data?.masked ? t('{n} dado(s) mascarado(s)', { n: preview.data.masked }) : t('nenhum dado pessoal detectado')}</span>
                {preview.data?.features.length ? <><span className="text-muted-foreground">· {t('features:')}</span>{preview.data.features.map(f => <Pill key={f} tone="info">{f}</Pill>)}</> : null}
              </div>
              <Textarea value={prompt} onChange={e => setPrompt(e.target.value)} aria-label={t('Prompt da review')}
                className="min-h-72 flex-1 resize-none font-mono text-[11px] leading-relaxed" />
              <p className="text-[11px] text-muted-foreground">{t('Você pode editar. O texto passa de novo pelo mascaramento antes de ir ao modelo.')}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('Cancelar')}</Button>
            <Button disabled={!prompt || start.isPending} onClick={() => start.mutate({ url, title, prompt })}>
              {start.isPending ? <Loader2 className="animate-spin" /> : <Bot />} {t('Rodar review')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
