// Preço por milhão de tokens (USD) e janela de contexto por modelo.
// Fonte: platform.claude.com/docs/en/about-claude/pricing e /models/overview (consultado em 2026-10-19).
// Colunas: input, cache write 5m, cache write 1h, cache read, output.
const M = 1e6;
const P = (input, w5, w1, read, output, context = 1e6) => ({ input, w5, w1, read, output, context });

const MODELS = [
  [/fable-5-1$/, P(10, 12.5, 20, 0.25, 50)],
  [/opus-5-5$/, P(4, 5, 8, 0.2, 20)],
  [/sonnet-5-5$/, P(2, 2.5, 4, 0.1, 10)],
  [/haiku-5-5$/, P(0.1, 0.125, 0.2, 0.01, 0.5)],
  [/opus-(5|4-8|4-7|4-6)$/, P(5, 6.25, 10, 0.5, 25)],
  [/opus-4-5$/, P(5, 6.25, 10, 0.5, 25, 2e5)],
  [/opus-4(-1)?$/, P(15, 18.75, 30, 1.5, 75, 2e5)],
  [/sonnet-4-6$/, P(3, 3.75, 6, 0.3, 15)],
  [/sonnet-4(-5)?$/, P(3, 3.75, 6, 0.3, 15, 2e5)],
  [/haiku-4-5$/, P(1, 1.25, 2, 0.1, 5, 2e5)],
];
// Haiku 5.5 cobra mais quando o prompt inteiro passa de 100k tokens.
const HAIKU55_LONG = P(0.5, 0.625, 1, 0.05, 2.5);

// claude-opus-4-1-20250805, us.anthropic.claude-sonnet-4-5-v1:0, claude-opus-5-5[1m] -> forma curta
const normalize = model => String(model || '').toLowerCase()
  .replace(/\[1m\]$/, '').replace(/-v\d+(:\d+)?$/, '').replace(/-\d{8}$/, '');

function priceOf(model) {
  const id = normalize(model);
  const hit = MODELS.find(([re]) => re.test(id));
  return hit ? hit[1] : null;
}

function contextOf(model) {
  const p = priceOf(model);
  if (/\[1m\]/i.test(model || '')) return 1e6;
  return p ? p.context : 2e5;
}

// Custo de uma resposta a partir do bloco usage do transcript.
function costOf(model, u) {
  let p = priceOf(model);
  if (!p || !u) return 0;
  const w1 = (u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0;
  const w5 = (u.cache_creation_input_tokens || 0) - w1;
  const prompt = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  if (/haiku-5-5/.test(model) && prompt > 100000) p = HAIKU55_LONG;
  return ((u.input_tokens || 0) * p.input + w5 * p.w5 + w1 * p.w1 +
    (u.cache_read_input_tokens || 0) * p.read + (u.output_tokens || 0) * p.output) / M;
}

module.exports = { priceOf, contextOf, costOf };
