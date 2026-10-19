#!/usr/bin/env node
// Painel local: lê as sessões gravadas pelo hook e empurra mudanças para o navegador via SSE.
const http = require('http');
const fs = require('fs');
const path = require('path');
require('./lib/env');
const store = require('./lib/store');
const gitlib = require('./lib/git');
const { launch } = require('./lib/launch');
const { computeMetrics } = require('./lib/metrics');

const PORT = Number(process.env.AGENT_BOARD_PORT || 9999);
const HOST = '127.0.0.1'; // só na sua máquina: o estado inclui caminhos e prompts
const PAGE = path.join(__dirname, 'public', 'index.html');
const APPROVAL_WAIT = Number(process.env.AGENT_BOARD_APPROVAL_WAIT || 120);

fs.mkdirSync(store.SESSIONS, { recursive: true });

const readSessions = () => store.readDir(store.SESSIONS).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
// Sessão com pasta existente (um worktree removido não deve virar "spawn git ENOENT").
function findSession(id) {
  const s = store.readJson(store.sessionFile(id)) || store.readJson(path.join(store.HISTORY, store.safeId(id) + '.json'));
  if (!s || !s.cwd) throw Object.assign(new Error('sessão sem pasta'), { status: 404 });
  if (!fs.existsSync(s.cwd)) throw Object.assign(new Error(`pasta não existe mais: ${s.cwd}`), { status: 404 });
  return s;
}

const clients = new Set();
let lastPayload = '';
function broadcast(force = false) {
  const payload = JSON.stringify(readSessions());
  if (!force && payload === lastPayload) return;
  lastPayload = payload;
  for (const res of clients) res.write(`data: ${payload}\n\n`);
}

let timer;
const schedule = () => { clearTimeout(timer); timer = setTimeout(() => broadcast(), 120); };
try { fs.watch(store.SESSIONS, schedule); } catch { /* sem watch: o polling abaixo cobre */ }
setInterval(() => broadcast(), 3000);

// Batimento: o hook só espera aprovação pelo painel quando há uma aba aberta.
const heartbeat = () => {
  try { store.writeJson(path.join(store.ROOT, 'server.json'), { pid: process.pid, port: PORT, clients: clients.size, at: Date.now() }); } catch {}
};
setInterval(heartbeat, 5000);
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000);

// Dispensar não apaga: arquiva em history/ para as métricas.
function archive(id) {
  const file = store.sessionFile(id);
  const s = store.readJson(file);
  if (s) store.writeJson(path.join(store.HISTORY, store.safeId(id) + '.json'), { ...s, archivedAt: Date.now() });
  try { fs.unlinkSync(file); } catch { /* já removida */ }
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 64 * 1024) { reject(new Error('corpo grande demais')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('JSON inválido')); } });
    req.on('error', reject);
  });
}

// Proteções para um servidor em localhost:
// - Host fixo bloqueia DNS rebinding (um site se passando por localhost);
// - escritas exigem o cabeçalho X-Agent-Board, que nenhum outro site consegue enviar sem preflight CORS.
const LOCAL_HOST = new RegExp(`^(127\\.0\\.0\\.1|localhost):${PORT}$`);
const LOCAL_ORIGIN = new RegExp(`^http://(127\\.0\\.0\\.1|localhost):${PORT}$`);
function allowed(req) {
  if (!LOCAL_HOST.test(req.headers.host || '')) return false;
  if (req.method === 'GET') return true;
  if (req.headers['x-agent-board'] !== '1') return false;
  return !req.headers.origin || LOCAL_ORIGIN.test(req.headers.origin);
}

const prCache = new Map(); // cwd -> { at, data }
const PR_TTL = 60 * 1000;

const routes = [
  ['GET', /^\/$/, (req, res) => send(res, 200, fs.readFileSync(PAGE), 'text/html; charset=utf-8')],
  ['GET', /^\/api\/sessions$/, (req, res) => send(res, 200, readSessions())],
  ['GET', /^\/api\/config$/, (req, res) => send(res, 200, { approvalWait: APPROVAL_WAIT, platform: process.platform })],
  ['GET', /^\/events$/, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(readSessions())}\n\n`);
    clients.add(res);
    heartbeat();
    req.on('close', () => { clients.delete(res); heartbeat(); });
  }],
  ['POST', /^\/api\/sessions\/([\w-]+)\/dismiss$/, (req, res, id) => { archive(id); broadcast(true); send(res, 200, { ok: true }); }],
  ['POST', /^\/api\/clear-ended$/, (req, res) => {
    for (const s of readSessions()) if (s.state === 'ended') archive(s.id);
    broadcast(true); send(res, 200, { ok: true });
  }],
  ['GET', /^\/api\/sessions\/([\w-]+)\/diff$/, async (req, res, id) => {
    const s = findSession(id);
    send(res, 200, (await gitlib.diffSummary(s.cwd)) || { error: 'não é um repositório git' });
  }],
  ['GET', /^\/api\/sessions\/([\w-]+)\/patch$/, async (req, res, id, url) => {
    const s = findSession(id);
    send(res, 200, await gitlib.diffPatch(s.cwd, url.searchParams.get('file') || undefined), 'text/plain; charset=utf-8');
  }],
  ['GET', /^\/api\/sessions\/([\w-]+)\/pr$/, async (req, res, id, url) => {
    const s = findSession(id);
    const key = `${s.cwd}@${s.branch || ''}`;
    const hit = prCache.get(key);
    if (hit && !url.searchParams.has('fresh') && Date.now() - hit.at < PR_TTL) return send(res, 200, hit.data);
    const data = await gitlib.prStatus(s.cwd);
    prCache.set(key, { at: Date.now(), data });
    send(res, 200, data);
  }],
  ['POST', /^\/api\/sessions\/([\w-]+)\/pr$/, async (req, res, id) => {
    const s = findSession(id);
    const url = await gitlib.createPr(s.cwd);
    prCache.clear();
    send(res, 200, { url });
  }],
  ['POST', /^\/api\/sessions\/([\w-]+)\/decision$/, async (req, res, id) => {
    const { requestId, behavior, message } = await readBody(req);
    const s = store.readJson(store.sessionFile(id));
    const pending = s && (s.approvals || []).find(a => a.requestId === requestId && a.remote);
    if (!pending) return send(res, 409, { error: 'pedido já respondido ou expirado' });
    if (!['allow', 'deny'].includes(behavior)) return send(res, 400, { error: 'behavior inválido' });
    store.writeJson(store.decisionFile(id, requestId),
      { requestId, behavior, message: message ? String(message).slice(0, 500) : undefined, at: Date.now() });
    send(res, 200, { ok: true });
  }],
  ['POST', /^\/api\/launch$/, async (req, res) => {
    const body = await readBody(req);
    send(res, 200, await launch({
      repo: String(body.repo || '').trim(), branch: String(body.branch || '').trim(),
      prompt: String(body.prompt || ''), worktree: !!body.worktree, tool: body.tool,
    }));
  }],
  ['GET', /^\/api\/repos$/, (req, res) => {
    // Pastas recentes, para sugerir no formulário de nova tarefa.
    const all = [...readSessions(), ...store.readDir(store.HISTORY)].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    send(res, 200, [...new Set(all.map(s => s.cwd).filter(Boolean))].slice(0, 30));
  }],
  ['GET', /^\/api\/metrics$/, (req, res, url) => {
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 7));
    const sessions = [...readSessions(), ...store.readDir(store.HISTORY)];
    send(res, 200, computeMetrics(store.readEvents(Date.now() - days * 86400000), sessions, days));
  }],
];

const server = http.createServer(async (req, res) => {
  if (!allowed(req)) return send(res, 403, { error: 'origem não permitida' });
  const url = new URL(req.url, `http://${req.headers.host}`);
  for (const [method, re, handler] of routes) {
    const m = req.method === method && url.pathname.match(re);
    if (!m) continue;
    try { return await handler(req, res, ...(m.length > 1 ? [m[1], url] : [url])); }
    catch (e) { return res.headersSent ? res.end() : send(res, e.status || 500, { error: (e.stderr || e.message || 'erro').split('\n')[0] }); }
  }
  send(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Painel de agentes em http://localhost:${PORT}`);
  console.log(`Lendo sessões de ${store.SESSIONS}`);
});
