#!/usr/bin/env node
// Modo demonstração: sobe o painel com dados fictícios, sem configurar nada.
//   npm run demo           (idioma do sistema)
//   npm run demo -- --en   (forçar inglês)   npm run demo -- --pt
// Nenhuma integração real é usada, mesmo que exista um .env. Os dados ficam numa pasta temporária.
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
  console.error(`Node ${process.versions.node}: o painel precisa do Node 22.13 ou mais novo (SQLite embutido).`);
  process.exit(1);
}

// Banco novo a cada demo, para as datas ficarem relativas a hoje.
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
  console.log('Primeira vez: compilando (≈ 30 s)…');
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
}

// Sessões de agentes de exemplo (passam pelo hook de verdade).
execFileSync(process.execPath, [path.join(root, 'demo.js')], { cwd: root, env, stdio: 'ignore' });

const port = process.env.AGENT_BOARD_PORT || '9999';
console.log(`\nTLDeck em modo demonstração: http://127.0.0.1:${port}\nDados fictícios em ${dir}. Ctrl+C para sair.\n`);
const server = spawn(process.execPath, [path.join(root, 'apps/server/dist/index.js')], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] });
const stop = () => server.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', code => process.exit(code ?? 0));
