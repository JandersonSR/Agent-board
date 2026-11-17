const test = require('node:test');
const assert = require('node:assert');
const { apply, taskIdOf, relPath } = require('../lib/state');

const ev = (name, extra = {}) => ({ tool: 'claude', session_id: 's1', cwd: 'C:\\work\\api', hook_event_name: name, ...extra });
const run = (...events) => { const s = {}; let now = 1000; for (const e of events) apply(s, e, now += 1000); return s; };

test('prompt -> working, the first prompt becomes the task', () => {
  const s = run(ev('SessionStart', { source: 'startup' }), ev('UserPromptSubmit', { prompt: 'faça X' }), ev('UserPromptSubmit', { prompt: 'e Y' }));
  assert.equal(s.state, 'working');
  assert.equal(s.task, 'faça X');
  assert.equal(s.lastPrompt, 'e Y');
  assert.equal(s.project, 'api');
});

test('Stop uses last_assistant_message and does not inherit the permission message', () => {
  const s = run(ev('UserPromptSubmit', { prompt: 'x' }),
    ev('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }),
    ev('Stop', {}));
  assert.equal(s.state, 'review');
  assert.equal(s.message, null);
  const s2 = run(ev('UserPromptSubmit', { prompt: 'x' }), ev('Stop', { last_assistant_message: 'Pronto.' }));
  assert.equal(s2.message, 'Pronto.');
});

test('the idle notice does not take the card out of review', () => {
  const s = {};
  apply(s, ev('Stop', { last_assistant_message: 'ok' }), 1);
  assert.equal(apply(s, ev('Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' }), 2), false);
  assert.equal(s.state, 'review');
});

test('notifications that ask for nothing are ignored', () => {
  const s = run(ev('UserPromptSubmit', { prompt: 'x' }));
  assert.equal(apply(s, ev('Notification', { notification_type: 'auth_success', message: 'ok' }), 5000), false);
  assert.equal(s.state, 'working');
});

test('PermissionRequest creates a request; the tool running clears it', () => {
  const s = run(ev('UserPromptSubmit', { prompt: 'x' }),
    ev('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, requestId: 'r1', remote: true }));
  assert.equal(s.state, 'needs_you');
  assert.equal(s.approvals.length, 1);
  assert.equal(s.approvals[0].summary, 'Bash: rm -rf build');
  apply(s, ev('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }), 99999);
  assert.equal(s.state, 'working');
  assert.deepEqual(s.approvals, []);
  assert.equal(s.message, null);
});

test('TodoWrite and TaskCreate/TaskUpdate become progress', () => {
  const s = run(ev('PostToolUse', { tool_name: 'TodoWrite', tool_input: { todos: [
    { content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress', activeForm: 'fazendo b' }] } }));
  assert.equal(s.todos.length, 2);
  assert.equal(s.todos[1].active, 'fazendo b');

  const t = run(
    ev('PostToolUse', { tool_name: 'TaskCreate', tool_input: { subject: 'um' }, tool_response: { task: { id: '1', subject: 'um' } } }),
    ev('PostToolUse', { tool_name: 'TaskCreate', tool_input: { subject: 'dois' }, tool_response: { task: { id: '2' } } }),
    ev('PostToolUse', { tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' } }),
    ev('PostToolUse', { tool_name: 'TaskUpdate', tool_input: { task_id: '2', status: 'deleted' } }));
  assert.deepEqual(t.todos.map(x => [x.id, x.status]), [['1', 'completed']]);
});

test('edited files: relative to the folder, ignoring case on Windows', () => {
  const s = run(ev('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: 'c:\\work\\api\\src\\a.ts' } }),
    ev('PostToolUse', { tool_name: 'Write', tool_input: { file_path: 'C:\\work\\api\\docs\\CHECKPOINT-feat.md' } }));
  assert.deepEqual(s.files, ['src\\a.ts', 'docs\\CHECKPOINT-feat.md']);
  assert.equal(s.checkpoint, 'docs\\CHECKPOINT-feat.md');
  assert.equal(relPath('/home/u/app', '/home/u/app/x.js'), 'x.js');
  assert.equal(relPath('/home/u/app', '/home/u/app2/x.js'), '/home/u/app2/x.js');
});

test('task ID: branch first, uppercase only, ignores acronyms', () => {
  assert.equal(taskIdOf('feat/FEAT-123-login', 'CONV-9 algo'), 'FEAT-123');
  assert.equal(taskIdOf(null, 'Corrigir CONV-9 no parser'), 'CONV-9');
  assert.equal(taskIdOf('feat/step-2', 'salvar em UTF-8'), null);
  assert.equal(taskIdOf('main', 'ISO-8601 datas'), null);
});

test('subagents and compaction', () => {
  const s = run(ev('SubagentStart'), ev('SubagentStart'), ev('SubagentStop'), ev('PreCompact', { trigger: 'auto' }));
  assert.equal(s.subagents, 1);
  assert.equal(s.compactions, 1);
  apply(s, ev('SessionStart', { source: 'compact' }), 99999);
  assert.notEqual(s.state, 'idle');
});

test('StopFailure marks an error', () => {
  const s = run(ev('StopFailure', { error: 'rate limit' }));
  assert.equal(s.state, 'review');
  assert.match(s.message, /^Finished with an error\. rate limit/);
});
