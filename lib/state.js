// Máquina de estados da sessão: recebe o estado salvo + um evento normalizado e devolve o novo estado.
// Sem I/O, para poder testar. O hook.js cuida de ler/gravar arquivos.
const path = require('path');

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// Notificações que significam "o agente parou e quer algo de você".
const ASKS = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']);
// Siglas que parecem ID de tarefa mas não são (UTF-8, ISO-8601...).
const NOT_TASK = new Set(['UTF', 'ISO', 'SHA', 'RFC', 'HTTP', 'TLS', 'ES', 'MD', 'IPV']);
const TASK_RE = process.env.AGENT_BOARD_TASK_RE ? new RegExp(process.env.AGENT_BOARD_TASK_RE, 'i') : null;

const trim = (s, n) => {
  if (!s) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

// FEAT-123 no nome da branch (feat/FEAT-123-login) ou no primeiro prompt.
function taskIdOf(...texts) {
  for (const t of texts) {
    if (!t) continue;
    if (TASK_RE) { const m = String(t).match(TASK_RE); if (m) return (m[1] || m[0]).toUpperCase(); continue; }
    // Só maiúsculas (FEAT-123), para não confundir com "step-2" ou "login-v2".
    for (const m of String(t).matchAll(/(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]{1,9})-(\d+)(?![A-Za-z0-9])/g)) {
      if (!NOT_TASK.has(m[1])) return `${m[1]}-${m[2]}`;
    }
  }
  return null;
}

function describeTool(ev) {
  const i = ev.tool_input || {};
  const name = ev.tool_name || 'ferramenta';
  if (name === 'Bash' || name === 'PowerShell') return `${name}: ${trim(i.command, 80)}`;
  if (i.file_path) return `${name}: ${path.basename(i.file_path)}`;
  if (i.pattern) return `${name}: ${trim(i.pattern, 60)}`;
  if (i.url) return `${name}: ${trim(i.url, 60)}`;
  if (i.description) return `${name}: ${trim(i.description, 60)}`;
  return name;
}

// Caminho relativo à pasta da sessão. No Windows a comparação ignora maiúsculas (c:\ vs C:\).
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

// Lista de tarefas do agente: TodoWrite (antigo) e TaskCreate/TaskUpdate (atual).
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

// Aplica um evento. Retorna false quando o evento deve ser ignorado (nada a gravar).
function apply(s, ev, now, helpers = {}) {
  const prev = s.state;
  s.id = ev.session_id;
  s.tool = ev.tool;
  s.cwd = ev.cwd || s.cwd;
  s.project = path.basename((s.cwd || '').replace(/[\\/]+$/, '')) || 'sessão';
  s.transcript = ev.transcript_path || s.transcript;
  s.createdAt = s.createdAt || now;
  if (ev.permission_mode) s.mode = ev.permission_mode;

  switch (ev.hook_event_name) {
    case 'SessionStart':
      // Depois de compactar ou retomar, a sessão continua de onde estava.
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
      // No Cursor, postToolUse já conta a ação; afterFileEdit/afterShellExecution só detalham.
      if (ev.source !== 'afterFileEdit' && ev.source !== 'afterShellExecution') s.toolCount = (s.toolCount || 0) + 1;
      // A ferramenta rodou: qualquer pedido de permissão pendente já foi resolvido (no terminal ou no painel).
      s.approvals = [];
      if (s.message && prev === 'needs_you') s.message = null;
      trackFiles(s, ev);
      trackTodos(s, ev);
      break;
    case 'PermissionRequest':
      s.state = 'needs_you';
      s.message = `Pedindo permissão: ${describeTool(ev)}`;
      s.approvals = [...(s.approvals || []).filter(a => now - a.at < 15 * 60000), {
        requestId: ev.requestId, at: now, tool: ev.tool_name || 'ferramenta', summary: describeTool(ev),
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
      // O aviso de "ocioso" depois que o agente terminou não deve tirar o card de "pronto para revisar".
      const idleNudge = type === 'idle_prompt' || /waiting for your input/i.test(ev.message || '');
      if (prev === 'review' && idleNudge) return false;
      s.state = 'needs_you';
      s.message = trim(ev.message, 300);
      break;
    }
    case 'AgentResponse': // só Cursor: guarda a última fala para mostrar quando terminar
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
      s.message = last || null; // não herda a mensagem de um pedido de permissão antigo
      if (ev.status === 'aborted') s.message = `Interrompido. ${s.message || ''}`.trim();
      if (ev.status === 'error' || ev.hook_event_name === 'StopFailure') s.message = `Terminou com erro. ${s.message || trim(ev.error, 200) || ''}`.trim();
      if (helpers.gitBranch) s.branch = helpers.gitBranch(s.cwd) || s.branch;
      break;
    }
    case 'PreCompact':
      s.compactions = (s.compactions || 0) + 1;
      s.lastTool = `Compactando contexto (${ev.trigger || 'auto'})`;
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
