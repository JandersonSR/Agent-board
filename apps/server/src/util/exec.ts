import { execFile } from 'node:child_process';

export interface ExecResult { ok: boolean; stdout: string; stderr: string; code: number | null }

/**
 * Executa um binário com argumentos fixos (nunca concatena entrada do usuário em shell).
 * No Windows, CLIs instaladas via npm são .cmd e exigem shell; por isso os args são sempre
 * constantes ou validados por quem chama.
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
