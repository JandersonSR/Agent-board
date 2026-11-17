// Cursor on Windows: stdin arrives through PowerShell 5.1 with a BOM and UTF-8 read as Windows-1252.
const test = require('node:test');
const assert = require('node:assert');
const { cleanStdin, undoMojibake } = require('../lib/encoding');

/** What PowerShell does: UTF-8 bytes decoded as Windows-1252. */
const mangle = s => new TextDecoder('windows-1252').decode(Buffer.from(s, 'utf8'));
const BOM = String.fromCharCode(0xfeff);

test('undoes UTF-8 read as Windows-1252 (accents, dashes, quotes, euro, emoji)', () => {
  for (const s of ['é protótipo, não a V3', 'Decisões — “aspas” e ‘simples’ … € 10', 'ação ✅ pronto 🚀', 'ÀÉÍÓÚ àéíóú ç Ç ñ ü']) {
    assert.notEqual(mangle(s), s);
    assert.equal(undoMojibake(mangle(s)), s);
  }
});

test('leaves correct text alone', () => {
  for (const s of ['plain ascii {"a":1}', 'já está certo: ação, não, é', 'Ã© sozinho num texto com 中文', '']) {
    assert.equal(undoMojibake(s), s);
  }
});

test('cleanStdin: BOM + mangled JSON become the original JSON', () => {
  const json = JSON.stringify({ hook_event_name: 'afterAgentResponse', text: 'Decisões: protótipo não é a V3' });
  assert.equal(cleanStdin(BOM + mangle(json) + '\r\n').trim(), json);
  assert.equal(cleanStdin(json), json);
});
