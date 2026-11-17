// Session state machine: takes the saved state + a normalized event and returns the new state.
// No I/O, so it can be tested. hook.js takes care of reading/writing files.
const path = require('path');

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// Notifications that mean "the agent stopped and wants something from you".
const ASKS = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']);
// Acronyms that look like a task ID but are not (UTF-8, ISO-8601...).
const NOT_TASK = new Set(['UTF', 'ISO', 'SHA', 'RFC', 'HTTP', 'TLS', 'ES', 'MD', 'IPV']);
const TASK_RE = process.env.AGENT_BOARD_TASK_RE ? new RegExp(process.env.AGENT_BOARD_TASK_RE, 'i') : null;

const trim = (s, n) => {
  if (!s) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

// FEAT-123 in the branch name (feat/FEAT-123-login) or in the first prompt.
function taskIdOf(...texts) {
  for (const t of texts) {
    if (!t) continue;
    if (TASK_RE) { const m = String(t).match(TASK_RE); if (m) return (m[1] || m[0]).toUpperCase(); continue; }
    // Uppercase only (FEAT-123), so it is not confused with "step-2" or "login-v2".
    for (const m of String(t).matchAll(/(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]{1,9})-(\d+)(?![A-Za-z0-9])/g)) {
      if (!NOT_TASK.has(m[1])) return `${m[1]}-${m[2]}`;
    }
  }
  return null;
}

function describeTool(ev) {
  const i = ev.tool_input || {};
  const name = ev.tool_name || 'tool';
  if (name === 'Bash' || name === 'PowerShell') return `${name}: ${trim(i.command, 80)}`;
  if (i.file_path) return `${name}: ${path.basename(i.file_path)}`;
  if (i.pattern) return `${name}: ${trim(i.pattern, 60)}`;
  if (i.url) return `${name}: ${trim(i.url, 60)}`;
  if (i.description) return `${name}: ${trim(i.description, 60)}`;
  return name;
}

// Path relative to the session folder. On Windows the comparison ignores case (c:\ vs C:\).
function relPath(cwd, f) {
  if (!cwd) return f;
  const win = /^[a-z]:[\\/]/i.test(cwd);
  const norm = p => (win ? p.replace(/\//g, '\\').toLowerCase() : p);
  const base = norm(cwd).replace(/[\\/]+$/, '');
  return norm(f).startsWith(base + (win ? '\\' : '/'))
    ? (win ? path.win32 : path.posix).relative(cwd, f) : f;
}

function trackFiles(s, ev) {
  if (!EDIT_TOOLS.has(ev.tool_name)) return;
  const f = (ev.tool_input || {}).file_path || (ev.tool_input || {}).notebook_path;
  if (!f) return;
  const files = new Set(s.files || []);
  files.add(relPath(s.cwd, f));
  s.files = [...files].slice(-50);
  if (/checkpoint/i.test(path.basename(f))) s.checkpoint = relPath(s.cwd, f);
}

// The agent's task list: TodoWrite (old) and TaskCreate/TaskUpdate (current).
function trackTodos(s, ev) {
  const i = ev.tool_input || {};
  if (ev.tool_name === 'TodoWrite' && Array.isArray(i.todos)) {
    s.todos = i.todos.slice(0, 50).map((t, n) => ({
      id: String(t.id || n), text: trim(t.content || t.subject, 120), status: t.status || 'pending', active: trim(t.activeForm, 120),
    }));
    return;
  }
  if (ev.tool_name === 'TaskCreate') {
    const r = ev.tool_response || {};
    const id = String((r.task && r.task.id) || r.id || `t${(s.todos || []).length + 1}`);
    s.todos = [...(s.todos || []).filter(t => t.id !== id),
      { id, text: trim(i.subject || i.description, 120), status: 'pending', active: trim(i.activeForm || i.active_form, 120) }].slice(-50);
    return;
  }
  if (ev.tool_name === 'TaskUpdate') {
    const id = String(i.taskId || i.task_id || i.id || '');
    if (!id) return;
    if (i.status === 'deleted') { s.todos = (s.todos || []).filter(t => t.id !== id); return; }
    s.todos = (s.todos || []).map(t => t.id !== id ? t : {
      ...t, status: i.status || t.status, text: trim(i.subject, 120) || t.text, active: trim(i.activeForm || i.active_form, 120) || t.active,
    });
  }
}

// Applies an event. Returns false when the event should be ignored (nothing to write).
function apply(s, ev, now, helpers = {}) {
  const prev = s.state;
  s.id = ev.session_id;
  s.tool = ev.tool;
  s.cwd = ev.cwd || s.cwd;
  // Splits on / and \\: a Windows path (Cursor on Windows + deck on WSL) also becomes the folder name.
  s.project = (s.cwd || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'session';
  s.transcript = ev.transcript_path || s.transcript;
  s.createdAt = s.createdAt || now;
  if (ev.permission_mode) s.mode = ev.permission_mode;

  switch (ev.hook_event_name) {
    case 'SessionStart':
      // After compacting or resuming, the session continues where it was.
      if (ev.source === 'compact') break;
      s.state = 'idle';
      s.approvals = [];
      break;
    case 'UserPromptSubmit':
      s.state = 'working';
      s.lastPrompt = trim(ev.prompt, 300);
      if (!s.task) s.task = trim(ev.prompt, 140);
      s.message = null;
      s.lastResponse = null;
      s.approvals = [];
      s.startedTurnAt = now;
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure':
      s.state = 'working';
      s.lastTool = (ev.hook_event_name === 'PostToolUseFailure' ? '✗ ' : '') + describeTool(ev);
      // In Cursor, postToolUse already counts the action; afterFileEdit/afterShellExecution only add detail.
      if (ev.source !== 'afterFileEdit' && ev.source !== 'afterShellExecution') s.toolCount = (s.toolCount || 0) + 1;
      // The tool ran: any pending permission request was already resolved (in the terminal or on the deck).
      s.approvals = [];
      if (s.message && prev === 'needs_you') s.message = null;
      trackFiles(s, ev);
      trackTodos(s, ev);
      break;
    case 'PermissionRequest':
      s.state = 'needs_you';
      s.message = `Asking permission: ${describeTool(ev)}`;
      s.approvals = [...(s.approvals || []).filter(a => now - a.at < 15 * 60000), {
        requestId: ev.requestId, at: now, tool: ev.tool_name || 'tool', summary: describeTool(ev),
        detail: trim(JSON.stringify(ev.tool_input || {}), 1500), remote: !!ev.remote,
      }].slice(-10);
      break;
    case 'Notification': {
      const type = ev.notification_type;
      if (type && !ASKS.has(type) && type !== 'idle_prompt') {
        if (/^quota_/.test(type)) s.notice = trim(ev.message, 200);
        else return false;
        break;
      }
      // The "idle" notice after the agent finished must not take the card out of "ready for review".
      const idleNudge = type === 'idle_prompt' || /waiting for your input/i.test(ev.message || '');
      if (prev === 'review' && idleNudge) return false;
      s.state = 'needs_you';
      s.message = trim(ev.message, 300);
      break;
    }
    case 'AgentResponse': // Cursor only: keeps the last message to show when it finishes
      s.lastResponse = trim(ev.message, 400);
      s.state = s.state === 'review' ? 'review' : 'working';
      break;
    case 'Stop':
    case 'StopFailure': {
      s.state = 'review';
      s.approvals = [];
      s.subagents = 0;
      const last = s.tool === 'cursor' ? s.lastResponse
        : trim(ev.last_assistant_message, 400) || (helpers.lastAssistant ? helpers.lastAssistant(s.transcript) : null);
      s.message = last || null; // does not inherit the message of an old permission request
      if (ev.status === 'aborted') s.message = `Interrupted. ${s.message || ''}`.trim();
      if (ev.status === 'error' || ev.hook_event_name === 'StopFailure') s.message = `Finished with an error. ${s.message || trim(ev.error, 200) || ''}`.trim();
      if (helpers.gitBranch) s.branch = helpers.gitBranch(s.cwd) || s.branch;
      break;
    }
    case 'PreCompact':
      s.compactions = (s.compactions || 0) + 1;
      s.lastTool = `Compacting context (${ev.trigger || 'auto'})`;
      break;
    case 'SubagentStart':
      s.subagents = (s.subagents || 0) + 1;
      break;
    case 'SubagentStop':
      s.subagents = Math.max(0, (s.subagents || 0) - 1);
      break;
    case 'SessionEnd':
      s.state = 'ended';
      s.approvals = [];
      break;
    default:
      return false;
  }

  if (!s.branch && helpers.gitBranch) s.branch = helpers.gitBranch(s.cwd);
  s.taskId = taskIdOf(s.branch, s.task) || s.taskId || null;
  s.updatedAt = now;
  return true;
}

module.exports = { apply, taskIdOf, describeTool, relPath, trim };
