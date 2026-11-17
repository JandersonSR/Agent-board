import { describe, expect, it } from 'vitest';
import { ClaudeAgents, parseBgListing } from './claude-agents.js';

const ok = (stdout: string) => ({ ok: true, stdout, stderr: '' });

describe('parseBgListing', () => {
  it('only background sessions, whoever needs you first', () => {
    const r = parseBgListing(ok(JSON.stringify([
      { cwd: '/a', kind: 'interactive', startedAt: 1, name: 'x' },
      { cwd: '/a', kind: 'background', startedAt: 10, id: 'aaaa1111', state: 'done' },
      { cwd: '/b', kind: 'background', startedAt: 5, id: 'bbbb2222', state: 'blocked', status: 'waiting', waitingFor: 'permission prompt', extra: 1 },
      { cwd: '/c', kind: 'background', startedAt: 7, id: '-rf', state: 'working' },
      { kind: 'background' },
    ])));
    expect(r.available).toBe(true);
    if (r.available) expect(r.sessions.map(s => s.id)).toEqual(['bbbb2222', 'aaaa1111']);
  });
  it('version without agent view or without claude', () => {
    expect(parseBgListing(ok('3 subagents: reviewer, …'))).toMatchObject({ available: false, reason: expect.stringMatching(/v2\.1\.139/) });
    expect(parseBgListing({ ok: false, stdout: '', stderr: 'spawn claude ENOENT' })).toEqual({ available: false, reason: 'Claude Code not found' });
  });
});

describe('ClaudeAgents', () => {
  it('passes the id as an argument and refuses ids that look like options', async () => {
    const calls: string[][] = [];
    const ca = new ClaudeAgents('claude', async (_c, args) => { calls.push(args); return { ok: true, stdout: '[]', stderr: '', code: 0 }; });
    await ca.stop('7c5dcf5d');
    await ca.logs('7c5dcf5d');
    expect(calls).toEqual([['stop', '7c5dcf5d'], ['logs', '7c5dcf5d']]);
    await expect(ca.stop('--all')).rejects.toThrow(/invalid/);
    await expect(ca.logs('a; rm -rf /')).rejects.toThrow(/invalid/);
  });
  it('short cache on the listing', async () => {
    let n = 0;
    const ca = new ClaudeAgents('claude', async () => { n++; return { ok: true, stdout: '[]', stderr: '', code: 0 }; });
    await ca.list(); await ca.list();
    expect(n).toBe(1);
  });
});
