// Ponta a ponta: roda o hook.js de verdade numa pasta temporária.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hook.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-hook-'));
const env = { ...process.env, AGENT_BOARD_DIR: path.join(root, 'sessions'), AGENT_BOARD_NTFY: '', AGENT_BOARD_APPROVAL_WAIT: '20' };
const read = id => JSON.parse(fs.readFileSync(path.join(root, 'sessions', `${id}.json`), 'utf8'));
const send = (ev) => execFileSync(process.execPath, [HOOK], { input: JSON.stringify(ev), env }).toString();
const heartbeat = clients => fs.writeFileSync(path.join(root, 'server.json'), JSON.stringify({ at: Date.now(), clients }));

function sendAsync(ev) {
  const p = spawn(process.execPath, [HOOK], { env });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stdin.end(JSON.stringify(ev));
  return new Promise(r => p.on('exit', () => r(out)));
}
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 50)); }
  throw new Error('timeout');
}

test('grava estado e log de eventos', () => {
  send({ session_id: 'e1', cwd: root, hook_event_name: 'UserPromptSubmit', prompt: 'olá' });
  assert.equal(read('e1').state, 'working');
  const log = fs.readFileSync(path.join(root, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(log.map(e => [e.id, e.from, e.to]), [['e1', null, 'working']]);
});

test('Cursor: responde continue no beforeSubmitPrompt', () => {
  const out = send({ conversation_id: 'c1', workspace_roots: [root], hook_event_name: 'beforeSubmitPrompt', prompt: 'x' });
  assert.equal(out, '{"continue":true}');
  assert.equal(read('c1').tool, 'cursor');
});

test('permissão sem painel aberto: não espera, terminal decide', async () => {
  fs.rmSync(path.join(root, 'server.json'), { force: true });
  const t0 = Date.now();
  const out = await sendAsync({ session_id: 'p0', cwd: root, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.equal(out, '');
  assert.ok(Date.now() - t0 < 3000);
  assert.equal(read('p0').approvals[0].remote, false);
});

for (const behavior of ['allow', 'deny']) {
  test(`permissão respondida no painel: ${behavior}`, async () => {
    heartbeat(1);
    const id = `p-${behavior}`;
    const done = sendAsync({ session_id: id, cwd: root, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm i' } });
    const req = await until(() => { try { return read(id).approvals[0]; } catch { return null; } });
    assert.equal(req.remote, true);
    fs.mkdirSync(path.join(root, 'decisions'), { recursive: true });
    fs.writeFileSync(path.join(root, 'decisions', `${id}-${req.requestId}.json`), JSON.stringify({ requestId: req.requestId, behavior, message: 'não' }));
    const out = JSON.parse(await done);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PermissionRequest');
    assert.equal(out.hookSpecificOutput.decision.behavior, behavior);
    if (behavior === 'deny') assert.equal(out.hookSpecificOutput.decision.message, 'não');
    assert.deepEqual(read(id).approvals, []);
    assert.equal(read(id).state, 'working');
  });
}

test('permissão resolvida no terminal: o hook para de esperar', async () => {
  heartbeat(1);
  const done = sendAsync({ session_id: 'p-term', cwd: root, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } });
  await until(() => { try { return read('p-term').approvals.length; } catch { return 0; } });
  send({ session_id: 'p-term', cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.equal(await done, '');
  assert.equal(read('p-term').state, 'working');
});
