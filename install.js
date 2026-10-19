#!/usr/bin/env node
// Instala (ou remove com --uninstall) os hooks do painel.
//   node install.js            -> Claude Code (~/.claude/settings.json)
//   node install.js --cursor   -> Cursor      (~/.cursor/hooks.json)
// Faz backup antes e preserva qualquer hook que você já tenha.
const fs = require('fs');
const path = require('path');
const os = require('os');
require('./lib/env');

const HOOK = path.join(__dirname, 'hook.js');
const COMMAND = `node "${HOOK}"`;
const uninstall = process.argv.includes('--uninstall');
const cursor = process.argv.includes('--cursor');

const TARGET = cursor
  ? { file: path.join(os.homedir(), '.cursor', 'hooks.json'), name: 'Cursor',
      events: ['sessionStart', 'beforeSubmitPrompt', 'postToolUse', 'afterShellExecution', 'afterFileEdit', 'afterAgentResponse', 'stop', 'sessionEnd'] }
  : { file: path.join(os.homedir(), '.claude', 'settings.json'), name: 'Claude Code',
      events: ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification',
        'PreCompact', 'SubagentStart', 'SubagentStop', 'Stop', 'StopFailure', 'SessionEnd'] };
// PermissionRequest espera a resposta do painel: o timeout do hook precisa cobrir essa espera.
const APPROVAL_WAIT = Number(process.env.AGENT_BOARD_APPROVAL_WAIT || 120);
const timeoutOf = ev => (ev === 'PermissionRequest' ? APPROVAL_WAIT + 30 : 10);
const MATCHER_EVENTS = new Set(['PostToolUse', 'PostToolUseFailure']);

let config = {};
if (fs.existsSync(TARGET.file)) {
  const raw = fs.readFileSync(TARGET.file, 'utf8');
  try { config = JSON.parse(raw); } catch {
    console.error(`Não consegui ler ${TARGET.file} (JSON inválido). Corrija o arquivo e rode de novo.`);
    process.exit(1);
  }
  fs.writeFileSync(`${TARGET.file}.bak-agent-board`, raw);
} else {
  fs.mkdirSync(path.dirname(TARGET.file), { recursive: true });
}

const isOurs = h => typeof h.command === 'string' &&
  (h.command.includes(HOOK) || (h.command.includes('agent-board') && h.command.includes('hook.js')));
config.hooks = config.hooks || {};
if (cursor) config.version = config.version || 1;

for (const ev of TARGET.events) {
  let entries = config.hooks[ev] || [];
  if (cursor) {
    // Cursor: lista plana de { command, timeout }
    entries = entries.filter(h => !isOurs(h));
    if (!uninstall) entries.push({ command: COMMAND, timeout: 10 });
  } else {
    // Claude Code: grupos { matcher?, hooks: [{ type, command }] }
    entries = entries
      .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isOurs(h)) }))
      .filter(g => g.hooks.length > 0);
    if (!uninstall) {
      const group = { hooks: [{ type: 'command', command: COMMAND, timeout: timeoutOf(ev) }] };
      if (MATCHER_EVENTS.has(ev)) group.matcher = '*';
      entries.push(group);
    }
  }
  if (entries.length) config.hooks[ev] = entries; else delete config.hooks[ev];
}
if (!Object.keys(config.hooks).length) delete config.hooks;

fs.writeFileSync(TARGET.file, JSON.stringify(config, null, 2) + '\n');
console.log(uninstall
  ? `Hooks do painel removidos do ${TARGET.name} (${TARGET.file}).`
  : `Hooks instalados no ${TARGET.name} (${TARGET.file}, backup em .bak-agent-board).\n` +
    (cursor ? 'Reinicie o Cursor para ele carregar os hooks. ' : 'Sessões novas já aparecem no painel. ') +
    'Suba o painel com: npm start');
