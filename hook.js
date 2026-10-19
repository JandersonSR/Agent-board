#!/usr/bin/env node
// Hook do Claude Code e do Cursor: grava o estado de cada sessão em ~/.agent-board/sessions/<id>.json
// Nunca deve atrapalhar o agente: qualquer erro é engolido e o processo sai com código 0.
// Única exceção proposital: em PermissionRequest o hook espera a resposta do painel (se ele estiver aberto).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
require('./lib/env');
const store = require('./lib/store');
const { apply, trim } = require('./lib/state');
const { updateUsage } = require('./lib/transcript');

const NTFY = process.env.AGENT_BOARD_NTFY; // ex.: https://ntfy.sh/meu-topico-secreto (opcional)
const APPROVAL_WAIT = Number(process.env.AGENT_BOARD_APPROVAL_WAIT || 120); // segundos; 0 desliga

function gitBranch(cwd) {
  if (!cwd) return null;
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500, windowsHide: true,
    }).toString().trim() || null;
  } catch { return null; }
}

// Última fala do agente, lida do fim do transcript (versões antigas do Claude Code não mandam last_assistant_message).
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

// O painel está aberto em alguma aba? O servidor grava um "batimento" a cada poucos segundos.
function boardWatching() {
  const hb = store.readJson(path.join(store.ROOT, 'server.json'));
  return !!hb && Date.now() - hb.at < 15000 && hb.clients > 0;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Espera a resposta do painel. Sai sem decidir (o terminal pergunta normalmente) se:
// o tempo acabar, o painel fechar, ou o pedido for resolvido por outro caminho.
async function waitDecision(id, requestId) {
  const file = store.decisionFile(id, requestId);
  const deadline = Date.now() + APPROVAL_WAIT * 1000;
  let checks = 0;
  while (Date.now() < deadline) {
    const d = store.readJson(file);
    if (d && d.requestId === requestId) { try { fs.unlinkSync(file); } catch {} return d; }
    const s = store.readJson(store.sessionFile(id));
    if (!s || !(s.approvals || []).some(a => a.requestId === requestId)) return { resolved: true };
    if (++checks % 10 === 0 && !boardWatching()) return null;
    await sleep(400);
  }
  return null;
}

function save(file, s, prev) {
  store.writeJson(file, s);
  if (s.state !== prev) {
    store.logEvent({ ts: s.updatedAt, id: s.id, project: s.project, cwd: s.cwd, task: s.task, taskId: s.taskId, tool: s.tool, from: prev || null, to: s.state });
  }
}

// Relê o arquivo antes de gravar: outros eventos da sessão podem ter chegado durante a espera.
function updateApproval(file, requestId, change) {
  const s = store.readJson(file);
  if (!s || !(s.approvals || []).some(a => a.requestId === requestId)) return;
  const prev = s.state;
  change(s);
  s.updatedAt = Date.now();
  save(file, s, prev);
}

async function main() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }
  // O Cursor espera uma resposta neste evento; responder "continue" garante que o prompt nunca é bloqueado.
  if (raw && raw.hook_event_name === 'beforeSubmitPrompt') process.stdout.write('{"continue":true}');
  const ev = raw && normalize(raw);
  if (!ev || !ev.session_id) return;

  const approval = ev.hook_event_name === 'PermissionRequest';
  const remote = approval && APPROVAL_WAIT > 0 && boardWatching();
  if (approval) Object.assign(ev, { requestId: crypto.randomBytes(6).toString('hex'), remote });

  fs.mkdirSync(store.SESSIONS, { recursive: true });
  const file = store.sessionFile(ev.session_id);
  const s = store.readJson(file) || {};
  const prev = s.state;
  if (!apply(s, ev, Date.now(), { gitBranch, lastAssistant })) return;

  if (s.tool === 'claude' && s.transcript) {
    try {
      s.usage = updateUsage(s.transcript, s.usage);
      if (s.usage.title) s.title = s.usage.title;
    } catch { /* uso é opcional */ }
  }
  save(file, s, prev);
  if (s.state !== prev && (s.state === 'needs_you' || s.state === 'review')) await notify(s);

  if (!remote) return;
  const d = await waitDecision(ev.session_id, ev.requestId);
  if (d && d.resolved) return; // respondido no terminal
  if (!d) {
    // Tempo esgotado ou painel fechado: o pedido continua visível, mas só o terminal responde.
    updateApproval(file, ev.requestId, x => { x.approvals = x.approvals.map(a => a.requestId === ev.requestId ? { ...a, remote: false } : a); });
    return;
  }
  const decision = d.behavior === 'allow'
    ? { behavior: 'allow' }
    : { behavior: 'deny', message: d.message || 'Negado pelo painel de agentes.' };
  updateApproval(file, ev.requestId, x => {
    const a = x.approvals.find(r => r.requestId === ev.requestId);
    x.approvals = x.approvals.filter(r => r.requestId !== ev.requestId);
    if (!x.approvals.length) Object.assign(x, { state: 'working', message: null });
    x.lastTool = `${d.behavior === 'allow' ? 'Aprovado' : 'Negado'} no painel: ${a.summary}`;
  });
  await new Promise(r => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }), r));
}

main().catch(() => {}).finally(() => process.exit(0));
