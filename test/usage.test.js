const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { updateUsage } = require('../lib/transcript');
const { costOf, contextOf, priceOf } = require('../lib/pricing');
const { computeMetrics } = require('../lib/metrics');

test('preço e contexto por modelo, inclusive IDs com data e [1m]', () => {
  assert.equal(priceOf('claude-opus-5-5').input, 4);
  assert.equal(priceOf('claude-opus-4-1-20250805').input, 15);
  assert.equal(priceOf('claude-opus-4-20250514').input, 15);
  assert.equal(priceOf('claude-sonnet-4-5-20250929').context, 2e5);
  assert.equal(priceOf('claude-haiku-4-5-20251001').output, 5);
  assert.equal(contextOf('claude-sonnet-4-5[1m]'), 1e6);
  assert.equal(priceOf('gpt-x'), null);
  // 1M tokens de entrada no Opus 5.5 = $4; 1M de saída = $20
  assert.equal(costOf('claude-opus-5-5', { input_tokens: 1e6, output_tokens: 1e6 }), 24);
  // Haiku 5.5 acima de 100k de prompt usa a faixa longa
  assert.equal(costOf('claude-haiku-5-5', { input_tokens: 2e5 }), 0.1);
});

test('transcript: conta cada resposta uma vez e lê só o que é novo', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ab-')), 't.jsonl');
  const usage = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 };
  const line = (id, extra = {}) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-opus-5-5', usage, content: [] }, ...extra }) + '\n';
  fs.writeFileSync(file, line('m1') + line('m1') + JSON.stringify({ type: 'ai-title', aiTitle: 'Login JWT' }) + '\n');
  let u = updateUsage(file, undefined);
  assert.equal(u.turns, 1);
  assert.equal(u.output, 100);
  assert.equal(u.title, 'Login JWT');
  assert.equal(u.context, 1110);
  assert.equal(u.contextMax, 1e6);
  fs.appendFileSync(file, line('m1') + line('m2') + '{"type":"assist'); // linha pela metade no fim
  u = updateUsage(file, u);
  assert.equal(u.turns, 2);
  const offset = u.offset;
  assert.equal(updateUsage(file, u).offset, offset);
});

test('métricas: tempo por estado, espera e por tarefa', () => {
  const H = 3600000, now = 10 * H;
  const events = [
    { ts: 1 * H, id: 'a', project: 'api', taskId: 'FEAT-1', from: null, to: 'working' },
    { ts: 3 * H, id: 'a', project: 'api', taskId: 'FEAT-1', from: 'working', to: 'needs_you' },
    { ts: 3.5 * H, id: 'a', project: 'api', taskId: 'FEAT-1', from: 'needs_you', to: 'working' },
    { ts: 4 * H, id: 'a', project: 'api', taskId: 'FEAT-1', from: 'working', to: 'review' },
    { ts: 5 * H, id: 'a', project: 'api', taskId: 'FEAT-1', from: 'review', to: 'ended' },
  ];
  const m = computeMetrics(events, [{ id: 'a', updatedAt: 5 * H, usage: { cost: 1.5, total: 1000 } }], 1, now);
  assert.equal(m.working, 2.5 * H);
  assert.equal(m.needsYou, 0.5 * H);
  assert.equal(m.review, 1 * H);
  assert.equal(m.waitingOnYou, 1.5 * H);
  assert.equal(m.medianResponse, 0.5 * H);
  assert.equal(m.cost, 1.5);
  assert.equal(m.tasks[0].key, 'FEAT-1');
  assert.equal(m.tasks[0].cost, 1.5);
});
