// Isolated worktree per task: the agent works in its own working copy, on a new branch,
// without touching the Tech Lead's main clone.
import fs from 'node:fs';
import path from 'node:path';
import { execCmd } from '../util/exec.js';

const git = (cwd: string, args: string[], timeoutMs = 30_000) => execCmd('git', args, { cwd, timeoutMs });

/** Remote base branch (e.g. origin/main), from origin/HEAD with fallbacks. */
export async function remoteBase(repoPath: string): Promise<string> {
  const head = await git(repoPath, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (head.ok && head.stdout.trim()) return head.stdout.trim();
  for (const ref of ['origin/main', 'origin/master', 'origin/develop']) {
    if ((await git(repoPath, ['rev-parse', '--verify', '--quiet', ref])).ok) return ref;
  }
  throw Object.assign(new Error('could not find the remote base branch (origin/HEAD, main, master or develop)'), { statusCode: 409 });
}

export async function createWorktree(repoPath: string, dir: string, branch: string): Promise<{ base: string }> {
  if (fs.existsSync(dir)) throw Object.assign(new Error(`the task folder already exists: ${dir}`), { statusCode: 409 });
  await git(repoPath, ['fetch', '--quiet', 'origin'], 120_000); // no network: go on with what is there
  const base = await remoteBase(repoPath);
  if ((await git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).ok) {
    throw Object.assign(new Error(`branch ${branch} already exists in the local clone`), { statusCode: 409 });
  }
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const r = await git(repoPath, ['worktree', 'add', '-b', branch, dir, base], 120_000);
  if (!r.ok) throw Object.assign(new Error(`git worktree add falhou: ${r.stderr.split('\n')[0]}`), { statusCode: 500 });
  return { base };
}

export async function removeWorktree(repoPath: string, dir: string, branch: string): Promise<void> {
  await git(repoPath, ['worktree', 'remove', '--force', dir]);
  await git(repoPath, ['branch', '-D', branch]);
}

/** If the agent left uncommitted changes, the deck commits them so the PR carries everything. */
export async function commitLeftovers(dir: string, message: string): Promise<boolean> {
  const st = await git(dir, ['status', '--porcelain']);
  if (!st.ok || !st.stdout.trim()) return false;
  await git(dir, ['add', '-A']);
  return (await git(dir, ['commit', '-m', message])).ok;
}

export async function commitsAhead(dir: string, base: string): Promise<number> {
  const r = await git(dir, ['rev-list', '--count', `${base}..HEAD`]);
  return r.ok ? Number(r.stdout.trim()) || 0 : 0;
}

export async function pushBranch(dir: string, branch: string): Promise<void> {
  const r = await git(dir, ['push', '-u', 'origin', branch], 120_000);
  if (!r.ok) throw Object.assign(new Error(`git push falhou: ${r.stderr.split('\n').filter(Boolean).pop() ?? ''}`), { statusCode: 502 });
}

/** Repository instructions for the agent (isolated mode does not load CLAUDE.md by itself). */
export function repoInstructions(dir: string, max = 8000): string | undefined {
  for (const name of ['AGENTS.md', 'CLAUDE.md', '.cursor/rules/README.md']) {
    try { return fs.readFileSync(path.join(dir, name), 'utf8').slice(0, max); } catch { /* próximo */ }
  }
  return undefined;
}
