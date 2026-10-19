// "Nova tarefa": cria (opcionalmente) um worktree e abre um terminal com o agente já rodando.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { run } = require('./git');

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const validBranch = b => /^[\w./-]+$/.test(b) && !b.includes('..') && !b.startsWith('-') && !b.endsWith('/');

async function prepareDir({ repo, branch, worktree }) {
  if (!repo || !fs.existsSync(repo)) throw new Error('pasta do repositório não existe');
  if (!worktree) return repo;
  if (!branch || !validBranch(branch)) throw new Error('nome de branch inválido');
  const top = (await run('git', ['rev-parse', '--show-toplevel'], repo)).trim();
  const dir = path.join(path.dirname(top), `${path.basename(top)}-${slug(branch.split('/').pop())}`);
  if (fs.existsSync(dir)) throw new Error(`já existe: ${dir}`);
  const exists = await run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], top).then(() => true, () => false);
  await run('git', exists ? ['worktree', 'add', dir, branch] : ['worktree', 'add', dir, '-b', branch], top, 60000);
  return dir;
}

const psQuote = s => `'${String(s).replace(/'/g, "''")}'`;
const shQuote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

function openTerminal(dir, tool, prompt) {
  const detached = (cmd, args) => spawn(cmd, args, { cwd: dir, detached: true, stdio: 'ignore', windowsHide: false }).unref();
  if (tool === 'cursor') return detached(process.platform === 'win32' ? 'cmd' : 'cursor',
    process.platform === 'win32' ? ['/c', 'cursor', dir] : [dir]);

  if (process.platform === 'win32') {
    // -EncodedCommand evita qualquer problema de aspas com o prompt.
    const ps = `Set-Location -LiteralPath ${psQuote(dir)}; claude${prompt ? ' ' + psQuote(prompt) : ''}`;
    const encoded = Buffer.from(ps, 'utf16le').toString('base64');
    const shell = ['powershell', '-NoExit', '-EncodedCommand', encoded];
    const wt = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'wt.exe');
    if (fs.existsSync(wt)) return detached(wt, ['-w', '0', 'nt', '-d', dir, '--title', path.basename(dir), ...shell]);
    return detached('cmd', ['/c', 'start', '""', ...shell]);
  }
  const cmd = `cd ${shQuote(dir)} && claude${prompt ? ' ' + shQuote(prompt) : ''}`;
  if (process.platform === 'darwin') {
    const as = `tell application "Terminal" to do script ${JSON.stringify(cmd)}`;
    return detached('osascript', ['-e', as, '-e', 'tell application "Terminal" to activate']);
  }
  return detached('x-terminal-emulator', ['-e', 'sh', '-c', `${cmd}; exec $SHELL`]);
}

async function launch(opts) {
  const dir = await prepareDir(opts);
  openTerminal(dir, opts.tool === 'cursor' ? 'cursor' : 'claude', (opts.prompt || '').trim());
  return { dir };
}

module.exports = { launch, prepareDir, slug, validBranch };
