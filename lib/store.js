// Onde o painel guarda tudo. Hook e servidor compartilham estes caminhos.
//   <ROOT>/sessions/<id>.json   estado atual de cada sessão
//   <ROOT>/history/<id>.json    sessões dispensadas (para métricas)
//   <ROOT>/decisions/<id>.json  respostas do painel a pedidos de permissão
//   <ROOT>/events.jsonl         log de mudanças de estado (append-only)
const fs = require('fs');
const path = require('path');
const os = require('os');

const SESSIONS = process.env.AGENT_BOARD_DIR || path.join(os.homedir(), '.agent-board', 'sessions');
const ROOT = path.dirname(SESSIONS);
const HISTORY = path.join(ROOT, 'history');
const DECISIONS = path.join(ROOT, 'decisions');
const LAUNCH = path.join(ROOT, 'launch');
const EVENTS = path.join(ROOT, 'events.jsonl');

const safeId = id => String(id).replace(/[^\w-]/g, '');
const sessionFile = id => path.join(SESSIONS, safeId(id) + '.json');
const decisionFile = (id, requestId) => path.join(DECISIONS, `${safeId(id)}-${safeId(requestId)}.json`);

// Escrita atômica: quem lê nunca vê um JSON pela metade.
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function readDir(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter(f => f.endsWith('.json')).map(f => readJson(path.join(dir, f))).filter(Boolean);
}

function logEvent(e) {
  try {
    fs.mkdirSync(ROOT, { recursive: true });
    fs.appendFileSync(EVENTS, JSON.stringify(e) + '\n');
  } catch { /* métricas são opcionais */ }
}

function readEvents(sinceTs = 0) {
  let raw = '';
  try { raw = fs.readFileSync(EVENTS, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try { const e = JSON.parse(line); if (e.ts >= sinceTs) out.push(e); } catch { /* linha cortada */ }
  }
  return out;
}

module.exports = {
  SESSIONS, ROOT, HISTORY, DECISIONS, LAUNCH, EVENTS,
  safeId, sessionFile, decisionFile, writeJson, readJson, readDir, logEvent, readEvents,
};
