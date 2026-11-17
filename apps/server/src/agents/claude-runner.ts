// Runs Claude Code non-interactively (claude -p, stream-json).
// - No shell: arguments as an array, prompt through standard input (no command-line length limit).
// - Isolated: --setting-sources "" and --strict-mcp-config (only the MCP passed here). This avoids loading
//   global CLAUDE.md/plugins/hooks (from ~150k down to ~4k tokens of base context) and keeps the login.
// - ANTHROPIC_API_KEY is removed from the environment: it uses the Claude Code login and never bills the API by mistake.
// - Tools limited by --tools/--allowedTools/--disallowedTools with --permission-mode dontAsk
//   (anything not allowed is denied without asking).
// - Time limit: kills the process tree.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';

export interface RunSpec {
  prompt: string;
  cwd: string;
  model: string;
  tools: string[];            // built-in tools available
  allowedTools: string[];     // liberadas sem perguntar
  disallowedTools: string[];  // sempre negadas
  mcpConfig?: Record<string, unknown> | undefined;
  addDirs?: string[] | undefined;
  timeoutMs: number;
  persistSession?: boolean;   // allows "continue in the terminal" later
}

export type RunEvent =
  | { type: 'start'; sessionId?: string; model?: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; input: string }
  | { type: 'tool_result'; ok: boolean; text: string }
  | { type: 'denied'; name: string }
  | { type: 'stderr'; text: string };

export interface RunUsage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number; durationMs: number; turns: number }

export interface RunResult {
  ok: boolean;
  timedOut: boolean;
  cancelled: boolean;
  resultText: string;
  sessionId?: string | undefined;
  usage?: RunUsage | undefined;
  error?: string | undefined;
}

export function buildArgs(spec: RunSpec): string[] {
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose',
    '--model', spec.model,
    '--permission-mode', 'dontAsk',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--tools', spec.tools.join(','),
  ];
  if (spec.allowedTools.length) args.push('--allowedTools', ...spec.allowedTools);
  if (spec.disallowedTools.length) args.push('--disallowedTools', ...spec.disallowedTools);
  if (spec.mcpConfig) args.push('--mcp-config', JSON.stringify({ mcpServers: spec.mcpConfig }));
  for (const d of spec.addDirs ?? []) args.push('--add-dir', d);
  if (!spec.persistSession) args.push('--no-session-persistence');
  return args;
}

const short = (v: unknown, n = 300) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

/** Turns a stream-json line into log events (pure, testable). */
export function parseStreamLine(line: string): { events: RunEvent[]; result?: Record<string, unknown> } {
  let j: Record<string, unknown>;
  try { j = JSON.parse(line) as Record<string, unknown>; } catch { return { events: [] }; }
  const events: RunEvent[] = [];
  if (j.type === 'system' && j.subtype === 'init') events.push({ type: 'start', sessionId: j.session_id as string, model: j.model as string });
  if (j.type === 'assistant') {
    const content = ((j.message as { content?: unknown[] })?.content ?? []) as Array<Record<string, unknown>>;
    for (const c of content) {
      if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) events.push({ type: 'text', text: short(c.text, 2000) });
      if (c.type === 'tool_use') events.push({ type: 'tool', name: String(c.name), input: short(c.input) });
    }
  }
  if (j.type === 'user') {
    const content = ((j.message as { content?: unknown[] })?.content ?? []) as Array<Record<string, unknown>>;
    for (const c of content) {
      if (c.type === 'tool_result') {
        const text = Array.isArray(c.content) ? (c.content as Array<{ text?: string }>).map(x => x.text ?? '').join('') : String(c.content ?? '');
        events.push({ type: 'tool_result', ok: !c.is_error, text: short(text) });
      }
    }
  }
  if (j.type === 'result') {
    for (const d of (j.permission_denials as Array<{ tool_name?: string }> | undefined) ?? []) events.push({ type: 'denied', name: String(d.tool_name) });
    return { events, result: j };
  }
  return { events };
}

function usageOf(r: Record<string, unknown>): RunUsage {
  const u = (r.usage ?? {}) as Record<string, number>;
  return {
    inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    costUsd: Number(r.total_cost_usd ?? 0), durationMs: Number(r.duration_ms ?? 0), turns: Number(r.num_turns ?? 0),
  };
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  else try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
}

export interface RunHandle { promise: Promise<RunResult>; cancel: () => void }

export function runClaude(spec: RunSpec, onEvent: (e: RunEvent) => void, bin = 'claude'): RunHandle {
  fs.mkdirSync(spec.cwd, { recursive: true });
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const child = spawn(bin, buildArgs(spec), {
    cwd: spec.cwd, env, windowsHide: true, shell: false,
    stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  });

  let cancelled = false;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; killTree(child); }, spec.timeoutMs);

  const promise = new Promise<RunResult>((resolve) => {
    let buf = '';
    let final: Record<string, unknown> | undefined;
    let sessionId: string | undefined;
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const { events, result } = parseStreamLine(line);
        for (const ev of events) {
          if (ev.type === 'start' && ev.sessionId) sessionId = ev.sessionId;
          onEvent(ev);
        }
        if (result) final = result;
      }
    });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (t: string) => { if (t.trim()) onEvent({ type: 'stderr', text: short(t.trim(), 500) }); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, timedOut, cancelled, resultText: '', error: `could not start claude: ${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const resultText = typeof final?.result === 'string' ? final.result : '';
      const isError = final ? final.is_error === true : true;
      resolve({
        ok: !timedOut && !cancelled && !isError && code === 0,
        timedOut, cancelled, resultText, sessionId,
        usage: final ? usageOf(final) : undefined,
        error: timedOut ? 'time limit reached' : cancelled ? 'cancelado' : isError ? (resultText || `claude exited with code ${code}`) : undefined,
      });
    });
    child.stdin!.end(spec.prompt, 'utf8');
  });

  return { promise, cancel: () => { cancelled = true; killTree(child); } };
}
