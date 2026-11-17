// "New task": creates a worktree (optionally) and opens the agent in an interactive terminal.
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

export function LaunchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const repos = useQuery({ queryKey: ['repos'], queryFn: () => api.get<string[]>('/api/repos'), enabled: open });
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [prompt, setPrompt] = useState('');
  const [worktree, setWorktree] = useState(true);
  const [tool, setTool] = useState<'claude' | 'cursor'>('claude');

  useEffect(() => { if (open && !repo && repos.data?.[0]) setRepo(repos.data[0]); }, [open, repo, repos.data]);

  const launch = useMutation({
    mutationFn: () => api.post<{ dir: string }>('/api/launch', { repo, branch, prompt, worktree, tool }),
    onSuccess: (r) => {
      toast.success(t('Agent opened'), { description: r.dir });
      setPrompt(''); setBranch('');
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('New task')}</DialogTitle>
          <DialogDescription>{t('Opens the agent in a new terminal. The card shows up on the board when the session starts.')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); launch.mutate(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="repo">{t('Repository folder')}</Label>
            <Input id="repo" list="repo-suggestions" required value={repo} onChange={e => setRepo(e.target.value)} placeholder={t('C:\\path\\to\\repo')} className="font-mono text-xs" />
            <datalist id="repo-suggestions">{repos.data?.map(r => <option key={r} value={r} />)}</datalist>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={worktree} onCheckedChange={v => setWorktree(v === true)} /> {t('Create a new worktree')}</label>
            <RadioGroup value={tool} onValueChange={v => setTool(v as 'claude' | 'cursor')} className="flex gap-4">
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="claude" /> Claude Code</label>
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="cursor" /> Cursor</label>
            </RadioGroup>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="branch">Branch {worktree && <span className="text-muted-foreground">({t('required with a worktree')})</span>}</Label>
            <Input id="branch" required={worktree} value={branch} onChange={e => setBranch(e.target.value)} placeholder={t('feat/ID-123-description')} className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prompt">{t('First prompt')} <span className="text-muted-foreground">({t('becomes the card title')})</span></Label>
            <Textarea id="prompt" rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={t('Implement X with tests. Plan first and wait for my approval.')} />
          </div>
          {launch.error && <p className="text-sm text-danger" role="alert">{(launch.error as Error).message}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
            <Button type="submit" disabled={launch.isPending}>{launch.isPending ? <Loader2 className="animate-spin" /> : <Rocket />} {t('Open agent')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
