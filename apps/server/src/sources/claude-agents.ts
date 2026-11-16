// Sessões em segundo plano do agent view do Claude Code (`claude agents`, v2.1.139+).
// Só usa a interface pública: `claude agents --json --all`, `claude logs <id>` e `claude stop <id>`.
// Nada de ler ~/.claude/jobs (a documentação diz que não é estável).
import { z } from 'zod';
import { execCmd, type ExecResult } from '../util/exec.js';

export const BgSession = z.object({
  cwd: z.string(),
  kind: z.string(),
  startedAt: z.number(),
  id: z.string().optional(),
  state: z.string().optional(),       // working | blocked | done | failed | stopped
  pid: z.number().optional(),
  status: z.string().optional(),      // busy | waiting | idle (processo vivo)
  waitingFor: z.string().optional(),  // permission prompt | input needed | …
  sessionId: z.string().optional(),
  name: z.string().optional(),
}).passthrough();
export type BgSessionT = z.infer<typeof BgSession>;

export type BgListing =
  | { available: true; sessions: BgSessionT[] }
  | { available: false; reason: string };

/** IDs curtos do agent view: só letras, números e hífen, sem começar por hífen (vira argumento, nunca opção). */
export const BG_ID = /^[a-z0-9][a-z0-9-]{3,39}$/i;

/** Interpreta a saída de `claude agents --json --all`. Saída que não é JSON = versão sem agent view. */
export function parseBgListing(r: Pick<ExecResult, 'ok' | 'stdout' | 'stderr'>): BgListing {
  if (!r.ok && !r.stdout.trim()) {
    const msg = r.stderr.trim().split('\n')[0] ?? '';
    return { available: false, reason: /not found|ENOENT|não é reconhecido|not recognized/i.test(msg) ? 'Claude Code não encontrado' : msg || 'falha ao rodar claude agents' };
  }
  const text = r.stdout.trim();
  if (!text.startsWith('[')) return { available: false, reason: 'agent view indisponível: atualize o Claude Code (v2.1.139 ou mais novo)' };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { available: false, reason: 'saída inesperada de claude agents --json' }; }
  const arr = z.array(z.unknown()).safeParse(raw);
  if (!arr.success) return { available: false, reason: 'saída inesperada de claude agents --json' };
  const sessions = arr.data.map(x => BgSession.safeParse(x)).filter(p => p.success).map(p => p.data!)
    .filter(s => s.kind === 'background' && !!s.id && BG_ID.test(s.id))
    .sort((a, b) => order(a) - order(b) || b.startedAt - a.startedAt);
  return { available: true, sessions };
}

/** Quem precisa de você primeiro, depois quem trabalha, depois o resto. */
function order(s: BgSessionT): number {
  return s.state === 'blocked' ? 0 : s.state === 'working' ? 1 : s.state === 'done' ? 2 : 3;
}

export interface ClaudeAgentsPort {
  list(): Promise<BgListing>;
  logs(id: string): Promise<string>;
  stop(id: string): Promise<void>;
}

/** Implementação real, com cache curto para não abrir um processo a cada requisição. */
export class ClaudeAgents implements ClaudeAgentsPort {
  private cache: { at: number; value: BgListing } | undefined;
  constructor(private readonly bin = 'claude', private readonly run = execCmd) {}

  async list(): Promise<BgListing> {
    if (this.cache && Date.now() - this.cache.at < 4000) return this.cache.value;
    const value = parseBgListing(await this.run(this.bin, ['agents', '--json', '--all'], { timeoutMs: 15_000 }));
    this.cache = { at: Date.now(), value };
    return value;
  }

  private check(id: string): void {
    if (!BG_ID.test(id)) throw Object.assign(new Error('id de sessão inválido'), { statusCode: 400 });
  }

  async logs(id: string): Promise<string> {
    this.check(id);
    const r = await this.run(this.bin, ['logs', id], { timeoutMs: 15_000 });
    if (!r.ok) throw Object.assign(new Error(r.stderr.trim().split('\n')[0] || 'falha ao ler os logs'), { statusCode: 502 });
    return r.stdout.slice(-60_000);
  }

  async stop(id: string): Promise<void> {
    this.check(id);
    const r = await this.run(this.bin, ['stop', id], { timeoutMs: 15_000 });
    this.cache = undefined;
    if (!r.ok) throw Object.assign(new Error(r.stderr.trim().split('\n')[0] || 'falha ao parar a sessão'), { statusCode: 502 });
  }
}

/** Sessões fictícias para o modo demonstração. */
export class DemoClaudeAgents implements ClaudeAgentsPort {
  private sessions: BgSessionT[];
  constructor(now = Date.now()) {
    this.sessions = [
      { id: '7c5dcf5d', name: 'flaky-test-fix', kind: 'background', cwd: '/work/loans-api', startedAt: now - 42 * 60_000, state: 'blocked', status: 'waiting', waitingFor: 'permission prompt', pid: 4242 },
      { id: '3a91be20', name: 'rate-cache-spike', kind: 'background', cwd: '/work/loans-api', startedAt: now - 15 * 60_000, state: 'working', status: 'busy', pid: 4243 },
      { id: 'b2e40c11', name: 'docs-adr-outbox', kind: 'background', cwd: '/work/architecture', startedAt: now - 3 * 3_600_000, state: 'done' },
      { id: '9f0a7d33', name: 'contract-pdf-bug', kind: 'background', cwd: '/work/notifications', startedAt: now - 26 * 3_600_000, state: 'failed' },
    ];
  }
  async list(): Promise<BgListing> { return { available: true, sessions: [...this.sessions] }; }
  async logs(id: string): Promise<string> {
    const s = this.sessions.find(x => x.id === id);
    if (!s) throw Object.assign(new Error('sessão não encontrada'), { statusCode: 404 });
    return `● ${s.name}\n  Read src/simulation/installments.ts\n  Bash npm test\n  ✓ 212 passed\n${s.state === 'blocked' ? '? Allow Bash(npm run migrate)?' : ''}`;
  }
  async stop(id: string): Promise<void> {
    this.sessions = this.sessions.map(s => (s.id === id ? { ...s, state: 'stopped', status: undefined, waitingFor: undefined, pid: undefined } : s));
  }
}
