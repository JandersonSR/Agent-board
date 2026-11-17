import { execFile } from 'node:child_process';

export interface ExecResult { ok: boolean; stdout: string; stderr: string; code: number | null }

/**
 * Runs a binary with fixed arguments (never concatenates user input into a shell).
 * On Windows, CLIs installed through npm are .cmd files and need a shell; that is why the args are always
 * constants or validated by the caller.
 */
export function execCmd(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<ExecResult> {
  return new Promise(resolve => {
    execFile(cmd, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 8000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      shell: process.platform === 'win32',
      env: opts.env ?? process.env,
    }, (err, stdout, stderr) => {
      const code = err && typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
        ? (err as unknown as { code: number }).code : err ? 1 : 0;
      resolve({ ok: !err, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code });
    });
  });
}
