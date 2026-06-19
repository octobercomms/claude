// Read a TrueType/OpenType font's family name (name table, nameID 1) so the
// caption renderer references the brand typeface by its *actual* family — the
// brand kit is the source of truth for typography, so we don't guess a family
// from the filename. Pragmatic parser: handles the common UTF-16BE / ASCII
// family-name encodings used by Latin fonts.

const fs = require('fs');

function familyName(fontPath) {
  try {
    const buf = fs.readFileSync(fontPath);
    const numTables = buf.readUInt16BE(4);
    let nameOff = 0;
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      if (buf.toString('ascii', rec, rec + 4) === 'name') { nameOff = buf.readUInt32BE(rec + 8); break; }
    }
    if (!nameOff) return null;
    const count = buf.readUInt16BE(nameOff + 2);
    const strBase = nameOff + buf.readUInt16BE(nameOff + 4);
    let fallback = null;
    for (let i = 0; i < count; i++) {
      const rec = nameOff + 6 + i * 12;
      const nameID = buf.readUInt16BE(rec + 4);
      if (nameID !== 1) continue; // 1 = Font Family
      const len = buf.readUInt16BE(rec + 8);
      const off = buf.readUInt16BE(rec + 10);
      const slice = buf.subarray(strBase + off, strBase + off + len);
      // UTF-16BE strings are full of 0x00 high bytes for Latin text — strip them;
      // otherwise treat as ASCII/Latin1.
      const hasNulls = slice.includes(0x00);
      const name = (hasNulls ? Buffer.from(slice.filter(b => b !== 0x00)) : slice).toString('latin1').trim();
      if (name) { if (/[A-Za-z]/.test(name)) return name; fallback = fallback || name; }
    }
    return fallback;
  } catch { return null; }
}

module.exports = { familyName };
