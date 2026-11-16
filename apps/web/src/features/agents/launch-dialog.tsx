// "Nova tarefa": cria (opcionalmente) um worktree e abre o agente num terminal interativo.
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
      toast.success('Agente aberto', { description: r.dir });
      setPrompt(''); setBranch('');
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova tarefa</DialogTitle>
          <DialogDescription>Abre o agente num terminal novo. O card aparece no quadro quando a sessão começar.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); launch.mutate(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="repo">Pasta do repositório</Label>
            <Input id="repo" list="repo-suggestions" required value={repo} onChange={e => setRepo(e.target.value)} placeholder="C:\caminho\do\repo" className="font-mono text-xs" />
            <datalist id="repo-suggestions">{repos.data?.map(r => <option key={r} value={r} />)}</datalist>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={worktree} onCheckedChange={v => setWorktree(v === true)} /> Criar worktree novo</label>
            <RadioGroup value={tool} onValueChange={v => setTool(v as 'claude' | 'cursor')} className="flex gap-4">
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="claude" /> Claude Code</label>
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="cursor" /> Cursor</label>
            </RadioGroup>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="branch">Branch {worktree && <span className="text-muted-foreground">(obrigatória com worktree)</span>}</Label>
            <Input id="branch" required={worktree} value={branch} onChange={e => setBranch(e.target.value)} placeholder="feat/ID-123-descricao" className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prompt">Primeiro prompt <span className="text-muted-foreground">(vira o título do card)</span></Label>
            <Textarea id="prompt" rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Implemente X com testes. Planeje primeiro e espere minha aprovação." />
          </div>
          {launch.error && <p className="text-sm text-danger" role="alert">{(launch.error as Error).message}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={launch.isPending}>{launch.isPending ? <Loader2 className="animate-spin" /> : <Rocket />} Abrir agente</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
