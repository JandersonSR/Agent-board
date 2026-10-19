#!/usr/bin/env node
// Hook do Claude Code: grava o estado de cada sessão em ~/.agent-board/sessions/<id>.json
// Nunca deve atrapalhar o agente: qualquer erro é engolido e o processo sai com código 0.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const DIR = process.env.AGENT_BOARD_DIR || path.join(os.homedir(), '.agent-board', 'sessions');
const NTFY = process.env.AGENT_BOARD_NTFY; // ex.: https://ntfy.sh/meu-topico-secreto (opcional)
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const trim = (s, n) => {
  if (!s) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

function gitBranch(cwd) {
  if (!cwd) return null;
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500,
    }).toString().trim() || null;
  } catch { return null; }
}

function describeTool(ev) {
  const i = ev.tool_input || {};
  const name = ev.tool_name || 'ferramenta';
  if (name === 'Bash') return `Bash: ${trim(i.command, 80)}`;
  if (i.file_path) return `${name}: ${path.basename(i.file_path)}`;
  if (i.pattern) return `${name}: ${trim(i.pattern, 60)}`;
  return name;
}

function trackFiles(s, ev) {
  if (!EDIT_TOOLS.has(ev.tool_name)) return;
  const f = (ev.tool_input || {}).file_path || (ev.tool_input || {}).notebook_path;
  if (!f) return;
  const rel = s.cwd && f.startsWith(s.cwd) ? path.relative(s.cwd, f) : f;
  const files = new Set(s.files || []);
  files.add(rel);
  s.files = [...files].slice(-50);
}

// Última fala do agente, lida do fim do transcript (JSONL).
function lastAssistant(transcript) {
  if (!transcript) return null;
  try {
    const { size } = fs.statSync(transcript);
    const len = Math.min(size, 256 * 1024);
    const fd = fs.openSync(transcript, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      let row;
      try { row = JSON.parse(lines[i]); } catch { continue; }
      if (row.type !== 'assistant') continue;
      const content = row.message && row.message.content;
      const text = Array.isArray(content)
        ? content.filter(c => c.type === 'text').map(c => c.text).join(' ')
        : typeof content === 'string' ? content : '';
      if (text.trim()) return trim(text, 400);
    }
  } catch { /* transcript indisponível */ }
  return null;
}

async function notify(s) {
  if (!NTFY) return;
  const what = s.state === 'needs_you' ? 'precisa de você' : 'terminou, pronto para revisar';
  try {
    await fetch(NTFY, {
      method: 'POST',
      body: `${s.project}${s.branch ? ` (${s.branch})` : ''}: ${what}`,
      signal: AbortSignal.timeout(2000),
    });
  } catch { /* sem rede: ignora */ }
}

// Cursor manda outro formato (conversation_id, workspace_roots, eventos em camelCase).
// Traduzimos para o formato do Claude Code e seguimos pelo mesmo caminho.
const CURSOR_EVENTS = {
  sessionStart: 'SessionStart',
  beforeSubmitPrompt: 'UserPromptSubmit',
  postToolUse: 'PostToolUse',
  afterShellExecution: 'PostToolUse',
  afterFileEdit: 'PostToolUse',
  afterAgentResponse: 'AgentResponse',
  stop: 'Stop',
  sessionEnd: 'SessionEnd',
};

function normalize(ev) {
  if (ev.session_id && !ev.conversation_id) return { ...ev, tool: 'claude' };
  const name = CURSOR_EVENTS[ev.hook_event_name];
  if (!name || !ev.conversation_id) return null;
  const out = {
    tool: 'cursor',
    source: ev.hook_event_name,
    session_id: ev.conversation_id,
    cwd: (ev.workspace_roots && ev.workspace_roots[0]) || ev.cwd,
    hook_event_name: name,
    prompt: ev.prompt,
    message: ev.text,
    status: ev.status,
  };
  if (ev.hook_event_name === 'afterFileEdit') {
    out.tool_name = 'Edit';
    out.tool_input = { file_path: ev.file_path };
  } else if (ev.hook_event_name === 'afterShellExecution') {
    out.tool_name = 'Bash';
    out.tool_input = { command: ev.command };
  } else {
    out.tool_name = ev.tool_name;
    out.tool_input = typeof ev.tool_input === 'object' ? ev.tool_input : {};
  }
  return out;
}

async function main() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }
  // O Cursor espera uma resposta neste evento; responder "continue" garante que o prompt nunca é bloqueado.
  if (raw && raw.hook_event_name === 'beforeSubmitPrompt') process.stdout.write('{"continue":true}');
  const ev = raw && normalize(raw);
  if (!ev || !ev.session_id) return;

  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, String(ev.session_id).replace(/[^\w-]/g, '') + '.json');
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* sessão nova */ }

  const now = Date.now();
  const prev = s.state;
  s.id = ev.session_id;
  s.tool = ev.tool;
  s.cwd = ev.cwd || s.cwd;
  s.project = path.basename(s.cwd || '') || 'sessão';
  s.transcript = ev.transcript_path || s.transcript;
  s.createdAt = s.createdAt || now;
  s.updatedAt = now;

  switch (ev.hook_event_name) {
    case 'SessionStart':
      s.state = 'idle';
      s.branch = gitBranch(s.cwd);
      break;
    case 'UserPromptSubmit':
      s.state = 'working';
      s.lastPrompt = trim(ev.prompt, 300);
      if (!s.task) s.task = trim(ev.prompt, 140);
      s.message = null;
      s.lastResponse = null;
      s.startedTurnAt = now;
      break;
    case 'PostToolUse':
      s.state = 'working';
      s.lastTool = describeTool(ev);
      // No Cursor, postToolUse já conta a ação; afterFileEdit/afterShellExecution só detalham.
      if (ev.source !== 'afterFileEdit' && ev.source !== 'afterShellExecution') s.toolCount = (s.toolCount || 0) + 1;
      trackFiles(s, ev);
      break;
    case 'Notification': {
      // O aviso de "ocioso" depois que o agente terminou não deve tirar o card de "pronto para revisar".
      const idleNudge = /waiting for your input/i.test(ev.message || '');
      if (prev === 'review' && idleNudge) return;
      s.state = 'needs_you';
      s.message = trim(ev.message, 300);
      break;
    }
    case 'AgentResponse': // só Cursor: guarda a última fala para mostrar quando terminar
      s.lastResponse = trim(ev.message, 400);
      s.state = s.state === 'review' ? 'review' : 'working';
      break;
    case 'Stop':
      s.state = 'review';
      s.branch = gitBranch(s.cwd) || s.branch;
      s.message = (s.tool === 'cursor' ? s.lastResponse : lastAssistant(s.transcript)) || s.message;
      if (ev.status === 'aborted') s.message = `Interrompido. ${s.message || ''}`.trim();
      if (ev.status === 'error') s.message = `Terminou com erro. ${s.message || ''}`.trim();
      break;
    case 'SessionEnd':
      s.state = 'ended';
      break;
    default:
      return;
  }

  if (!s.branch) s.branch = gitBranch(s.cwd);

  // Escrita atômica: o painel nunca lê um JSON pela metade.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, file);

  if (s.state !== prev && (s.state === 'needs_you' || s.state === 'review')) await notify(s);
}

main().catch(() => {}).finally(() => process.exit(0));
