// Fixes the stdin that Cursor hands to hooks on Windows. Cursor runs the hook through Windows PowerShell 5.1
// (Get-Content file -Raw | & { $input | node hook.js }), which:
//   1. prefixes the text with a UTF-8 BOM (JSON.parse then fails), and
//   2. reads the UTF-8 file as Windows-1252 and re-encodes it, so "é" arrives as "Ã©" (mojibake).
// Both are undone here. Text that is not mojibake comes back unchanged.

// Windows-1252 bytes 0x80–0x9F that are not Latin-1 (0xA0–0xFF and the undefined bytes map to the same code point).
const CP1252 = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
  [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91],
  [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98],
  [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

// A UTF-8 lead byte (Â–ô) followed by what would be a continuation byte, as Windows-1252 shows them.
const LOOKS_LIKE_MOJIBAKE = /[Â-ô][\u0080-¿ŒœŠšŸŽžƒˆ˜–-…‰‹›€™]/;

/** Reverses "UTF-8 bytes decoded as Windows-1252". Leaves the text alone when that is not what happened. */
function undoMojibake(text) {
  if (!LOOKS_LIKE_MOJIBAKE.test(text)) return text;
  const bytes = [];
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c < 0x100) bytes.push(c);
    else if (CP1252.has(c)) bytes.push(CP1252.get(c));
    else return text; // a character Windows-1252 cannot produce: this text was not mangled
  }
  const fixed = Buffer.from(bytes).toString('utf8');
  return fixed.includes('�') ? text : fixed;
}

/** Hook stdin as text: without the BOM and with the accents back. */
function cleanStdin(text) {
  return undoMojibake(String(text).replace(/^﻿/, ''));
}

module.exports = { undoMojibake, cleanStdin };
