#!/usr/bin/env node
// Installs (or removes with --uninstall) the deck's hooks.
//   node install.js            -> Claude Code (~/.claude/settings.json)
//   node install.js --cursor   -> Cursor      (~/.cursor/hooks.json)
// Backs up first and keeps any hook you already have.
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
// PermissionRequest waits for the deck's answer: the hook timeout must cover that wait.
const APPROVAL_WAIT = Number(process.env.AGENT_BOARD_APPROVAL_WAIT || 120);
const timeoutOf = ev => (ev === 'PermissionRequest' ? APPROVAL_WAIT + 30 : 10);
const MATCHER_EVENTS = new Set(['PostToolUse', 'PostToolUseFailure']);

let config = {};
if (fs.existsSync(TARGET.file)) {
  const raw = fs.readFileSync(TARGET.file, 'utf8');
  try { config = JSON.parse(raw); } catch {
    console.error(`Could not read ${TARGET.file} (invalid JSON). Fix the file and run again.`);
    process.exit(1);
  }
  fs.writeFileSync(`${TARGET.file}.bak-agent-board`, raw);
} else {
  fs.mkdirSync(path.dirname(TARGET.file), { recursive: true });
}

const isOurs = h => typeof h.command === 'string' &&
  (h.command.includes(HOOK) || ((h.command.includes('agent-board') || h.command.includes('tldeck')) && h.command.includes('hook.js')));
config.hooks = config.hooks || {};
if (cursor) config.version = config.version || 1;

for (const ev of TARGET.events) {
  let entries = config.hooks[ev] || [];
  if (cursor) {
    // Cursor: a flat list of { command, timeout }
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
  ? `Deck hooks removed from ${TARGET.name} (${TARGET.file}).`
  : `Hooks installed in ${TARGET.name} (${TARGET.file}, backup in .bak-agent-board).\n` +
    (cursor ? 'Restart Cursor so it loads the hooks. ' : 'New sessions already show up on the deck. ') +
    'Start the deck with: npm start');
