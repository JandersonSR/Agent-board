#!/usr/bin/env node
// Creates sample cards (one in each state) by passing real events through hook.js.
//   node demo.js          -> cria
//   node demo.js --clear  -> remove
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
require('./lib/env');
const store = require('./lib/store');

const HOOK = path.join(__dirname, 'hook.js');
const ID = n => `demo-${n}`;
const IDS = [1, 2, 3, 4, 5].map(ID);

if (process.argv.includes('--clear')) {
  for (const id of IDS) {
    for (const dir of [store.SESSIONS, store.HISTORY]) { try { fs.unlinkSync(path.join(dir, id + '.json')); } catch {} }
  }
  console.log('Sample cards removed.');
  process.exit(0);
}

const root = path.join(require('os').tmpdir(), 'agent-board-demo');
const send = (id, cwd, ev) => execFileSync(process.execPath, [HOOK], {
  input: JSON.stringify({ session_id: id, cwd, ...ev }),
  env: { ...process.env, AGENT_BOARD_APPROVAL_WAIT: '0', AGENT_BOARD_NTFY: '' },
});
// Cursor sends its own format (conversation_id, workspace_roots, camelCase events); the hook translates it.
const sendCursor = (id, cwd, ev) => execFileSync(process.execPath, [HOOK], {
  input: JSON.stringify({ conversation_id: id, workspace_roots: [cwd], ...ev }),
  env: { ...process.env, AGENT_BOARD_NTFY: '' },
});
const dir = name => { const d = path.join(root, name); fs.mkdirSync(d, { recursive: true }); return d; };

// 1. Needs you: asked for permission
const api = dir('my-api-login');
send(ID(1), api, { hook_event_name: 'UserPromptSubmit', prompt: 'FEAT-101 Implement JWT login with tests. Plan first.' });
send(ID(1), api, { hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: [
  { content: 'Ler o fluxo atual de auth', status: 'completed' },
  { content: 'Criar middleware JWT', status: 'in_progress', activeForm: 'Criando middleware JWT' },
  { content: 'Escrever testes', status: 'pending' },
] } });
send(ID(1), api, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm install jsonwebtoken' } });

// 2. Pronto para revisar
const hook = dir('my-api-webhook');
send(ID(2), hook, { hook_event_name: 'UserPromptSubmit', prompt: 'FIX-42 Webhook duplicado no pagamento' });
send(ID(2), hook, { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(hook, 'src', 'webhook.ts') } });
send(ID(2), hook, { hook_event_name: 'Stop', last_assistant_message: 'Added idempotency by the event key and a regression test. All tests pass.' });

// 3. Trabalhando
const web = dir('web-dashboard');
send(ID(3), web, { hook_event_name: 'UserPromptSubmit', prompt: 'Move charts to the new design system' });
send(ID(3), web, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test -- charts' } });

// 4. Ociosa
send(ID(4), dir('infra'), { hook_event_name: 'SessionStart', source: 'startup' });

// 5. Cursor, ready for review
const docs = dir('docs-site');
sendCursor(ID(5), docs, { hook_event_name: 'beforeSubmitPrompt', prompt: 'DOC-7 Update the setup guide for Node 22' });
sendCursor(ID(5), docs, { hook_event_name: 'afterFileEdit', file_path: path.join(docs, 'guide', 'setup.md') });
sendCursor(ID(5), docs, { hook_event_name: 'afterAgentResponse', text: 'Setup guide updated: Node 22.13+, npm 10 and the new install command.' });
sendCursor(ID(5), docs, { hook_event_name: 'stop', status: 'completed' });

console.log('5 sample cards created. Remove them with: npm run demo -- --clear');
