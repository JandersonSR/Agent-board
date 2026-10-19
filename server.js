#!/usr/bin/env node
// Painel local: lê ~/.agent-board/sessions e empurra mudanças para o navegador via SSE.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = process.env.AGENT_BOARD_DIR || path.join(os.homedir(), '.agent-board', 'sessions');
const PORT = Number(process.env.AGENT_BOARD_PORT || 7777);
const HOST = '127.0.0.1'; // só na sua máquina: o estado inclui caminhos e prompts
const PAGE = path.join(__dirname, 'public', 'index.html');

fs.mkdirSync(DIR, { recursive: true });

function readSessions() {
  const out = [];
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.json')) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))); } catch { /* em escrita */ }
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
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
try { fs.watch(DIR, schedule); } catch { /* sem watch: o polling abaixo cobre */ }
setInterval(() => broadcast(), 3000);
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000);

const safeId = id => String(id).replace(/[^\w-]/g, '');
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Bloqueia requisições de outras origens (outro site aberto no navegador não pode mexer no painel).
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    return send(res, 403, '{"error":"origin"}');
  }

  if (req.method === 'GET' && url.pathname === '/') {
    return send(res, 200, fs.readFileSync(PAGE), 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    return send(res, 200, JSON.stringify(readSessions()));
  }
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(readSessions())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  let m;
  if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/sessions\/([\w-]+)\/dismiss$/))) {
    try { fs.unlinkSync(path.join(DIR, safeId(m[1]) + '.json')); } catch { /* já removida */ }
    broadcast(true);
    return send(res, 200, '{"ok":true}');
  }
  if (req.method === 'POST' && url.pathname === '/api/clear-ended') {
    for (const s of readSessions()) {
      if (s.state === 'ended') { try { fs.unlinkSync(path.join(DIR, safeId(s.id) + '.json')); } catch {} }
    }
    broadcast(true);
    return send(res, 200, '{"ok":true}');
  }
  send(res, 404, '{"error":"not found"}');
});

server.listen(PORT, HOST, () => {
  console.log(`Painel de agentes em http://localhost:${PORT}`);
  console.log(`Lendo sessões de ${DIR}`);
});
