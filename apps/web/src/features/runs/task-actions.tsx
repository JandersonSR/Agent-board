// "Solve with an agent" on a queue issue: shows the planning prompt (editable) before starting.
import { useState } from 'react';
import { Bot, Loader2, ShieldCheck, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Mono, Pill } from '@/components/common';
import { useStartTask, useTaskPreview } from '@/hooks/use-runs';
import { t } from '@/lib/i18n';

export function TaskActions({ url, title, onStarted }: { url: string; title: string; onStarted?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const preview = useTaskPreview();
  const start = useStartTask(id => { setOpen(false); onStarted?.(id); });
  const p = preview.data;

  const openPreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(true);
    setPrompt('');
    preview.mutate(url, { onSuccess: d => setPrompt(d.prompt) });
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-xs" variant="ghost" aria-label={t('Solve with an agent: {title}', { title })} onClick={openPreview}><Wand2 /></Button>
        </TooltipTrigger>
        <TooltipContent>{t('Solve with an agent')}</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Bot className="size-4" /> {t('Solve with an agent')}</DialogTitle>
            <DialogDescription>
              {t('Step 1 of 3: the agent reads the code and proposes a plan without changing anything. You approve the plan, it implements in an isolated worktree, and the draft PR only opens with your click.')}
            </DialogDescription>
          </DialogHeader>
          {preview.isPending ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t('Reading the issue and building the prompt…')}</div>
          ) : preview.error ? (
            <p className="text-sm text-danger">{(preview.error as Error).message}</p>
          ) : p ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">{t('Repository')}</dt><dd><Mono className="text-[11px]">{p.repo}</Mono> · <Mono className="text-[11px] text-muted-foreground">{p.repoPath}</Mono></dd>
                <dt className="text-muted-foreground">Branch</dt><dd><Mono className="text-[11px]">{p.branch}</Mono></dd>
                <dt className="text-muted-foreground">{t('Verification')}</dt><dd>{p.verify ? <Mono className="text-[11px]">{p.verify}</Mono> : <span className="text-muted-foreground">{t('not configured (TASK_VERIFY)')}</span>}</dd>
              </dl>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <ShieldCheck className="size-3.5 text-success" />
                <span>{p.masked ? t('{n} item(s) masked', { n: p.masked }) : t('no personal data detected')}</span>
                {p.features.length ? <><span className="text-muted-foreground">· {t('features:')}</span>{p.features.map(f => <Pill key={f} tone="info">{f}</Pill>)}</> : null}
              </div>
              <Textarea value={prompt} onChange={e => setPrompt(e.target.value)} aria-label={t('Plan prompt')}
                className="min-h-64 flex-1 resize-none font-mono text-[11px] leading-relaxed" />
              <p className="text-[11px] text-muted-foreground">{t('You can edit it. The text is masked again before it goes to the model.')}</p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('Cancel')}</Button>
            <Button disabled={!prompt || start.isPending} onClick={() => start.mutate({ url, prompt })}>
              {start.isPending ? <Loader2 className="animate-spin" /> : <Bot />} {t('Start with the plan')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
