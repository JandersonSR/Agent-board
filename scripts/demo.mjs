#!/usr/bin/env node
// Demo mode: starts the deck with fictitious data, without configuring anything.
//   npm run demo           (idioma do sistema)
//   npm run demo -- --en   (force English)   npm run demo -- --pt
// No real integration is used, even if there is a .env. The data lives in a temporary folder.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(os.tmpdir(), 'agent-board-demo');
const args = process.argv.slice(2);
const sysLang = Intl.DateTimeFormat().resolvedOptions().locale || process.env.LANG || '';
const lang = args.includes('--en') ? 'en' : args.includes('--pt') ? 'pt-BR' : sysLang.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Node ${process.versions.node}: the deck needs Node 22.13 or newer (built-in SQLite).`);
  process.exit(1);
}

// A new database for each demo, so the dates are relative to today.
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });

const env = {
  ...process.env,
  DEMO: '1', DEMO_LANG: lang,
  AGENT_BOARD_DIR: path.join(dir, 'sessions'),
  AGENT_BOARD_DB: path.join(dir, 'data.db'),
  AGENT_BOARD_APPROVAL_WAIT: '0', AGENT_BOARD_NTFY: '',
};

const built = fs.existsSync(path.join(root, 'apps/server/dist/index.js')) && fs.existsSync(path.join(root, 'apps/web/dist/index.html'));
if (!built) {
  console.log('First run: building (≈ 30 s)…');
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
}

// Sample agent sessions (they go through the real hook).
execFileSync(process.execPath, [path.join(root, 'demo.js')], { cwd: root, env, stdio: 'ignore' });

const port = process.env.AGENT_BOARD_PORT || '9999';
console.log(`\nTLDeck in demo mode: http://127.0.0.1:${port}\nFictitious data in ${dir}. Ctrl+C to quit.\n`);
const server = spawn(process.execPath, [path.join(root, 'apps/server/dist/index.js')], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] });
const stop = () => server.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', code => process.exit(code ?? 0));
