// Per-post production brief — turns the AI-generated storyboard into a
// human-printable shot list following October's Video Style System. The
// AM opens this on their phone before filming; the client opens it when
// the AM hands them an editable brief.
//
// Two outputs from the same source:
//   - text (markdown) for the API + copy-paste
//   - HTML for a printable page opened in a new tab

const STYLE_DETAILS = {
  A: { title: 'TEXT HOOK', subtitle: '2-4s — black screen', filming: 'No filming. Built in CapCut from text template.', notes: 'The provocative opener. Bold white or yellow on black.' },
  B: { title: 'TALKING HEAD', subtitle: '10-45s — anchor', filming: 'Fixed setup. Front camera, RØDE mic, eye level. Max 2 takes.', notes: 'Talk like you\'re explaining it on a call. Bullets only, no full script.' },
  C: { title: 'WORD CARD', subtitle: '1-2s — punctuation', filming: 'No filming. CapCut text only.', notes: 'One word or 3-word phrase. Use 2-3 times per video max.' },
  D: { title: 'SCREEN REVEAL', subtitle: '4-8s — evidence', filming: 'Phone on tripod, angled at laptop screen. Warm up the screen first, close irrelevant tabs.', notes: 'Once per video max. Voiceover continues from B.' },
  E: { title: 'B-ROLL VOICEOVER', subtitle: '5-12s — context', filming: 'Rear camera, slow walk, steady. Hold each shot 8-10s. For clients: use their project work, not generic streets.', notes: 'Voiceover continues. No talking to camera.' },
  F: { title: 'PROP CLOSE-UP', subtitle: '3-6s — tactile', filming: 'Phone on tripod pointing down at hands. Warm desk light. Film several props in one session for a reusable library.', notes: 'Avoid stock-photo feel. Real objects, warm light, real texture.' },
  G: { title: 'KINETIC CTA', subtitle: '3-5s — close', filming: 'No filming. CapCut template, branded.', notes: 'URL or CTA. Same font/motion every video — this is the brand-consistency lever.' },
};

function buildBriefMarkdown(post) {
  const frames = post.storyboard || [];
  const lines = [];
  lines.push(`# ${post.platform.toUpperCase()} · ${post.kind.toUpperCase()}`);
  lines.push('');
  if (post.hook) { lines.push(`**HOOK** — ${post.hook}`); lines.push(''); }
  lines.push('## Caption');
  lines.push(post.caption || '_(no caption)_');
  lines.push('');
  if ((post.hashtags || []).length) {
    lines.push(`**Hashtags**: ${post.hashtags.map(h => `#${h.replace(/^#/, '')}`).join(' ')}`);
    lines.push('');
  }
  if (post.visual_concept) {
    lines.push('## Visual concept');
    lines.push(post.visual_concept);
    lines.push('');
  }
  if (frames.length) {
    lines.push('## Storyboard');
    lines.push('');
    for (const f of frames) {
      const styleHeader = f.style && STYLE_DETAILS[f.style]
        ? `**${f.style} · ${STYLE_DETAILS[f.style].title}** _(${STYLE_DETAILS[f.style].subtitle})_`
        : `**Frame ${f.frame}**`;
      lines.push(`### ${styleHeader}`);
      if (f.duration_sec) lines.push(`_Target ${f.duration_sec}s_`);
      lines.push('');
      lines.push(`**Shot**: ${f.shot || '—'}`);
      if (f.on_screen_text) lines.push(`**On-screen text**: ${f.on_screen_text}`);
      if (f.voiceover) lines.push(`**Voiceover**: "${f.voiceover}"`);
      if (f.style && STYLE_DETAILS[f.style]) {
        lines.push('');
        lines.push(`_Filming_: ${STYLE_DETAILS[f.style].filming}`);
      }
      lines.push('');
    }
  }
  // Teleprompter — a flat list of just the B-section voiceovers, in order,
  // so the AM can scroll through them while filming.
  const bLines = frames.filter(f => f.style === 'B').map(f => f.voiceover).filter(Boolean);
  if (bLines.length) {
    lines.push('## Teleprompter (B-sections only)');
    lines.push('');
    for (const [i, v] of bLines.entries()) {
      lines.push(`${i + 1}. ${v}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildBriefHtml(post, client) {
  const frames = post.storyboard || [];
  const bLines = frames.filter(f => f.style === 'B').map(f => f.voiceover).filter(Boolean);
  const frameRows = frames.map(f => {
    const style = f.style && STYLE_DETAILS[f.style] ? STYLE_DETAILS[f.style] : null;
    const styleBadge = style
      ? `<div class="style-badge"><span class="style-code">${f.style}</span><div><strong>${escapeHtml(style.title)}</strong><div class="style-sub">${escapeHtml(style.subtitle)}</div></div></div>`
      : `<strong>Frame ${f.frame}</strong>`;
    const filming = style ? `<div class="filming"><strong>Filming:</strong> ${escapeHtml(style.filming)}</div>` : '';
    const notes = style ? `<div class="filming"><em>${escapeHtml(style.notes)}</em></div>` : '';
    return `
      <div class="frame">
        ${styleBadge}
        ${f.duration_sec ? `<div class="duration">Target ${escapeHtml(f.duration_sec)}s</div>` : ''}
        <div class="shot"><strong>Shot:</strong> ${escapeHtml(f.shot || '—')}</div>
        ${f.on_screen_text ? `<div class="onscreen"><strong>On-screen:</strong> "${escapeHtml(f.on_screen_text)}"</div>` : ''}
        ${f.voiceover ? `<div class="voiceover"><strong>Voiceover:</strong> "${escapeHtml(f.voiceover)}"</div>` : ''}
        ${filming}
        ${notes}
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(client?.name || 'Client')} · Production brief</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 32px 40px; color: #1a1a1a; max-width: 760px; line-height: 1.5; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .meta { color: #666; font-size: 12px; margin-bottom: 24px; text-transform: uppercase; letter-spacing: 0.5px; }
    .pill-row { display: flex; gap: 6px; margin-bottom: 18px; flex-wrap: wrap; }
    .pill { font-size: 10px; padding: 3px 10px; border-radius: 3px; background: #eef2ff; color: #3949ab; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .section { margin-bottom: 22px; padding-bottom: 18px; border-bottom: 1px solid #eee; }
    .label { font-size: 10px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .caption { font-size: 14px; line-height: 1.6; white-space: pre-wrap; }
    .hook { font-size: 17px; font-weight: 700; margin-bottom: 4px; line-height: 1.3; }
    .hashtags { color: #3949ab; font-size: 12px; }
    .visual { font-size: 13px; color: #444; line-height: 1.6; padding: 10px 12px; background: #fafafa; border-left: 3px solid #E7CD41; }
    .storyboard h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; margin-bottom: 12px; }
    .frame { padding: 14px 16px; margin-bottom: 10px; border: 1px solid #eee; border-radius: 4px; background: #fff; page-break-inside: avoid; }
    .style-badge { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .style-code { width: 36px; height: 36px; border-radius: 18px; background: #1a1a1a; color: #fff; font-weight: 700; font-size: 18px; display: flex; align-items: center; justify-content: center; }
    .style-sub { color: #888; font-size: 11px; }
    .duration { color: #888; font-size: 11px; margin-bottom: 6px; }
    .shot, .onscreen, .voiceover { font-size: 13px; margin: 4px 0; }
    .filming { font-size: 11px; color: #666; margin-top: 4px; padding-top: 6px; border-top: 1px dotted #ddd; }
    .teleprompter { margin-top: 32px; padding: 18px; background: #1a1a1a; color: #fff; border-radius: 6px; }
    .teleprompter h2 { color: #E7CD41; font-size: 13px; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .teleprompter ol { margin: 0; padding-left: 20px; }
    .teleprompter li { font-size: 18px; line-height: 1.5; margin-bottom: 10px; }
    @media print { body { padding: 20px; } .frame, .teleprompter { page-break-inside: avoid; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(client?.name || '')} · Production brief</h1>
  <div class="meta">${escapeHtml(post.platform)} · ${escapeHtml(post.kind)}</div>

  <div class="pill-row">
    <span class="pill">${escapeHtml(post.platform)}</span>
    <span class="pill">${escapeHtml(post.kind)}</span>
    ${post.status ? `<span class="pill">${escapeHtml(post.status)}</span>` : ''}
  </div>

  ${post.hook ? `<div class="section">
    <div class="label">HOOK</div>
    <div class="hook">${escapeHtml(post.hook)}</div>
  </div>` : ''}

  <div class="section">
    <div class="label">CAPTION</div>
    <div class="caption">${escapeHtml(post.caption || '')}</div>
    ${(post.hashtags || []).length ? `<div class="hashtags" style="margin-top:8px;">${post.hashtags.map(h => `#${escapeHtml(h.replace(/^#/, ''))}`).join(' ')}</div>` : ''}
  </div>

  ${post.visual_concept ? `<div class="section">
    <div class="label">VISUAL CONCEPT</div>
    <div class="visual">${escapeHtml(post.visual_concept)}</div>
  </div>` : ''}

  ${frames.length ? `<div class="storyboard section" style="border-bottom:none;">
    <h2>Storyboard</h2>
    ${frameRows}
  </div>` : ''}

  ${bLines.length ? `<div class="teleprompter">
    <h2>Teleprompter — B-sections in order</h2>
    <ol>${bLines.map(v => `<li>${escapeHtml(v)}</li>`).join('')}</ol>
  </div>` : ''}
</body>
</html>`;
}

module.exports = { buildBriefMarkdown, buildBriefHtml, STYLE_DETAILS };
