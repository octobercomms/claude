// Build an ASS subtitle file for burned-in captions. Typography is fixed from
// the brand kit (font family + primary colour) — never model-chosen. Long
// transcript segments are split into short, punchy on-screen lines.

function hexToAssBgr(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '&H00FFFFFF';
  const r = m[1].slice(0, 2), g = m[1].slice(2, 4), b = m[1].slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase(); // ASS is &HAABBGGRR
}

function ts(t) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t - Math.floor(t)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// Split a segment's words into ~3-word chunks across the segment's duration so
// captions read like fast social subtitles rather than long blocks.
function chunkSegment(seg) {
  const words = String(seg.text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const perChunk = 3;
  const chunks = [];
  for (let i = 0; i < words.length; i += perChunk) chunks.push(words.slice(i, i + perChunk).join(' '));
  const dur = Math.max(0.4, (seg.end - seg.start));
  const each = dur / chunks.length;
  return chunks.map((text, i) => ({ start: seg.start + i * each, end: seg.start + (i + 1) * each, text }));
}

function buildAss(segments, { fontName = 'Arial', primaryHex = '#FFFFFF' } = {}) {
  const primary = hexToAssBgr(primaryHex);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Brand,${fontName},76,${primary},&H00101010,&H7F000000,1,0,1,4,2,2,80,80,260,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events = [];
  for (const seg of segments || []) {
    for (const c of chunkSegment(seg)) {
      const text = c.text.replace(/[\r\n]+/g, ' ').replace(/\{/g, '(').replace(/\}/g, ')');
      events.push(`Dialogue: 0,${ts(c.start)},${ts(c.end)},Brand,,0,0,0,,${text}`);
    }
  }
  return `${header}\n${events.join('\n')}\n`;
}

module.exports = { buildAss };
