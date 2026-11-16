// Sobe API (tsx watch) e web (Vite) juntos, sem dependência extra. Ctrl+C encerra os dois.
import { spawn } from 'node:child_process';

const procs = [
  ['api', ['run', 'dev', '-w', 'apps/server']],
  ['web', ['run', 'dev', '-w', 'apps/web']],
].map(([name, args]) => {
  const p = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = name === 'api' ? '\x1b[36m[api]\x1b[0m' : '\x1b[35m[web]\x1b[0m';
  const pipe = (stream, out) => stream.on('data', d => String(d).split(/\r?\n/).filter(Boolean).forEach(l => out.write(`${tag} ${l}\n`)));
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', code => { console.log(`${tag} saiu (${code})`); shutdown(); });
  return p;
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  for (const p of procs) if (!p.killed) p.kill();
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
