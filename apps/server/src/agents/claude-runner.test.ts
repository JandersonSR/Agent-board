import { describe, expect, it } from 'vitest';
import { buildArgs, parseStreamLine } from './claude-runner.js';

describe('buildArgs', () => {
  it('isolates the run and limits tools', () => {
    const args = buildArgs({
      prompt: 'x', cwd: '/tmp', model: 'sonnet', tools: ['Read', 'Bash'], allowedTools: ['Read', 'Bash(gh pr diff:*)'],
      disallowedTools: ['Bash(git push:*)'], timeoutMs: 1000,
    });
    expect(args).toContain('--strict-mcp-config');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Bash');
    expect(args).toContain('Bash(git push:*)');
    expect(args).toContain('--no-session-persistence');
    expect(args).not.toContain('x'); // the prompt goes through standard input
  });

  it('passes the explicit MCP and keeps the session when asked', () => {
    const args = buildArgs({
      prompt: '', cwd: '/', model: 'm', tools: [], allowedTools: [], disallowedTools: [], timeoutMs: 1,
      mcpConfig: { 'feat-map': { command: 'node', args: ['s.mjs'] } }, persistSession: true,
    });
    expect(JSON.parse(args[args.indexOf('--mcp-config') + 1]!)).toEqual({ mcpServers: { 'feat-map': { command: 'node', args: ['s.mjs'] } } });
    expect(args).not.toContain('--no-session-persistence');
  });
});

describe('parseStreamLine', () => {
  it('start, text, tool and result', () => {
    expect(parseStreamLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'sonnet' })).events)
      .toEqual([{ type: 'start', sessionId: 's1', model: 'sonnet' }]);
    const a = parseStreamLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'olá' }, { type: 'tool_use', name: 'Bash', input: { command: 'gh pr diff 1' } }] } }));
    expect(a.events).toEqual([{ type: 'text', text: 'olá' }, { type: 'tool', name: 'Bash', input: '{"command":"gh pr diff 1"}' }]);
    const r = parseStreamLine(JSON.stringify({ type: 'result', result: 'fim', permission_denials: [{ tool_name: 'Bash' }] }));
    expect(r.result?.result).toBe('fim');
    expect(r.events).toEqual([{ type: 'denied', name: 'Bash' }]);
  });

  it('ignores invalid lines and irrelevant events', () => {
    expect(parseStreamLine('not json').events).toEqual([]);
    expect(parseStreamLine(JSON.stringify({ type: 'rate_limit_event' })).events).toEqual([]);
  });
});
