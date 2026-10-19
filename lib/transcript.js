// Lê o transcript (JSONL) do Claude Code de forma incremental: só o que foi acrescentado desde a última vez.
// Extrai tokens, custo, uso de contexto, título automático e compactações.
const fs = require('fs');
const { costOf, contextOf } = require('./pricing');

const MAX_CHUNK = 4 * 1024 * 1024; // transcript novo e enorme: lê só o fim

// u = estado acumulado salvo na sessão (s.usage). Retorna o novo estado.
function updateUsage(transcript, prev) {
  const u = { offset: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0,
    turns: 0, context: 0, contextMax: 0, model: null, compactions: 0, recent: [], ...prev };
  if (!transcript) return u;
  let size;
  try { ({ size } = fs.statSync(transcript)); } catch { return u; }
  if (size < u.offset) Object.assign(u, { offset: 0 }); // arquivo recriado
  if (size === u.offset) return u;

  const start = Math.max(u.offset, size - MAX_CHUNK);
  const len = size - start;
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(transcript, 'r');
  try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
  const text = buf.toString('utf8');
  const end = text.lastIndexOf('\n');
  if (end < 0) return u; // linha ainda sendo escrita
  u.offset = start + Buffer.byteLength(text.slice(0, end + 1), 'utf8');

  for (const line of text.slice(0, end).split('\n')) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row.type === 'ai-title' && row.aiTitle) u.title = String(row.aiTitle).slice(0, 140);
    if (row.type === 'summary' || row.isCompactSummary) u.compactions++;
    if (row.type !== 'assistant' || !row.message || !row.message.usage) continue;
    const m = row.message;
    // Uma resposta aparece em várias linhas (uma por bloco) com o mesmo id e o mesmo usage: conta uma vez.
    if (m.id && u.recent.includes(m.id)) continue;
    if (m.id) u.recent = [...u.recent, m.id].slice(-50);
    const t = m.usage;
    u.model = m.model || u.model;
    u.input += t.input_tokens || 0;
    u.output += t.output_tokens || 0;
    u.cacheRead += t.cache_read_input_tokens || 0;
    u.cacheWrite += t.cache_creation_input_tokens || 0;
    u.cost += costOf(m.model, t);
    u.turns++;
    if (!row.isSidechain) {
      u.context = (t.input_tokens || 0) + (t.cache_read_input_tokens || 0) + (t.cache_creation_input_tokens || 0) + (t.output_tokens || 0);
      u.contextMax = contextOf(row.requestedModel || m.model);
    }
  }
  u.total = u.input + u.output + u.cacheRead + u.cacheWrite;
  u.cost = Math.round(u.cost * 1e6) / 1e6;
  return u;
}

module.exports = { updateUsage };
