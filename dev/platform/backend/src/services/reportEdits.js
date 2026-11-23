// Merging a human's edits onto a generated report.
//
// A report is an ordered array of typed sections. That array drives both
// renderers — the A4 PDF (pdfService.renderResolvedSection) and the email body
// (emailService.renderEmailSection) — so an edit applied here reaches the
// client's attachment and their email body as the same change. Editing the
// rendered html_content instead would have meant hand-written markup in a
// client email with no sanitiser in the project, and an attached PDF still
// saying the old thing.
//
// The server does NOT store the document it is sent. Every incoming section is
// merged onto the GENERATED section carrying the same id, taking only the
// fields that are editable for that section's type; everything else is copied
// from the original. So a payload cannot change a section's type, substitute
// its own chart data, or invent a section that was never resolved.
//
// That is stricter than it looks, for a reason particular to these renderers:
// a section with the wrong shape does not fail loudly. Both renderers return
// '' for a bar_chart with no chart and for an empty metrics_grid, so a
// malformed payload would not raise anything — the client would just receive a
// report with a section missing, and the send would look like a success.

// Per type, the fields a human may change. Everything absent from this list is
// taken from the generated section, whatever the payload says.
const EDITABLE_BY_TYPE = {
  narrative:              ['title', 'note', 'text'],
  metrics_grid:           ['title', 'note', 'cells'],
  tables:                 ['title', 'note'],
  bar_chart:              ['title', 'note'],
  position_distribution:  ['title', 'note'],
  note:                   ['title', 'note', 'text'],
  // A generated report cannot contain one: generateReport throws rather than
  // ship a failed section. Listed so an unexpected one is inert, not editable.
  error:                  [],
};

// Only these two on a metric cell. A delta, its direction and the previous
// value are a computed comparison against the prior period; typed by hand they
// would contradict the number they sit under, and nothing downstream
// recomputes them. Hide the section instead of hand-correcting a comparison.
const EDITABLE_CELL_FIELDS = ['label', 'value'];

// Caps, so a paste cannot produce a report nobody can open. Generous against
// real copy: the longest narrative section this has been seen to produce is
// under 2,000 characters.
const LIMITS = { title: 300, note: 2000, text: 20000, label: 120, value: 60 };

const ADDABLE_TYPES = ['note'];

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// Text in, text out. Both renderers escape on the way to HTML, so the stored
// value stays exactly what was typed; this only trims and bounds it.
function cleanText(value, limit, where) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${where} must be text, received ${Array.isArray(value) ? 'a list' : typeof value}`);
  }
  // Strip control characters except newline and tab; a stray \u0000 reaches
  // Postgres as an error on write, which would surface as a failed save with
  // nothing said about why.
  const stripped = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (stripped.length > limit) {
    throw new Error(`${where} is ${stripped.length} characters; the limit is ${limit}`);
  }
  return stripped;
}

function mergeCells(originalCells, incomingCells, sectionId) {
  const original = Array.isArray(originalCells) ? originalCells : [];
  if (incomingCells === undefined) return original;
  if (!Array.isArray(incomingCells)) {
    throw new Error(`Section ${sectionId}: cells must be a list`);
  }
  // Matched by position, with the count fixed. A payload that adds or drops a
  // cell is changing the shape of a metrics grid, not editing its wording, and
  // the chunking in both renderers (4 per row) lays out whatever it is given —
  // so a dropped cell would reflow the grid silently.
  if (incomingCells.length !== original.length) {
    throw new Error(
      `Section ${sectionId}: expected ${original.length} metric cell(s), received ${incomingCells.length}. `
      + 'Metric cells can be reworded but not added or removed; hide the section instead.'
    );
  }
  return original.map((cell, i) => {
    const incoming = incomingCells[i];
    if (!isPlainObject(incoming)) return cell;
    const merged = { ...cell };
    for (const field of EDITABLE_CELL_FIELDS) {
      const cleaned = cleanText(incoming[field], LIMITS[field], `Section ${sectionId}, cell ${i + 1} ${field}`);
      if (cleaned !== undefined) merged[field] = cleaned;
    }
    return merged;
  });
}

function mergeSection(original, incoming) {
  const editable = EDITABLE_BY_TYPE[original.type] || [];
  // Start from the generated section, so every field nobody may edit survives
  // exactly as resolved.
  const merged = { ...original };

  for (const field of editable) {
    if (field === 'cells') {
      if (incoming.cells !== undefined || original.cells !== undefined) {
        merged.cells = mergeCells(original.cells, incoming.cells, original.id);
      }
      continue;
    }
    const cleaned = cleanText(incoming[field], LIMITS[field], `Section ${original.id} ${field}`);
    if (cleaned !== undefined) merged[field] = cleaned;
  }

  // Hiding is available on every type, including the ones with no editable
  // text: it is the supported way to remove something, and it is reversible
  // because the section stays in the stored array.
  merged.hidden = incoming.hidden === true;
  return merged;
}

function newNoteSection(incoming, index) {
  if (!ADDABLE_TYPES.includes(incoming.type)) {
    throw new Error(
      `Cannot add a section of type "${incoming.type}". Only a note can be added to a generated report; `
      + 'every other section is resolved from connector data.'
    );
  }
  const id = typeof incoming.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(incoming.id)
    ? incoming.id
    : `note-${index + 1}`;
  const title = cleanText(incoming.title, LIMITS.title, `Note ${index + 1} title`) || '';
  const text = cleanText(incoming.text, LIMITS.text, `Note ${index + 1} text`) || '';
  if (!title.trim() && !text.trim()) {
    throw new Error(`Note ${index + 1} is empty — give it something to say or remove it`);
  }
  return { id, type: 'note', title, text, hidden: incoming.hidden === true, added: true };
}

// generated: the array as resolved (reports.summary.sections)
// incoming:  the array the editor sent back
// Returns the array to store. Throws with a sentence an operator can act on.
function mergeEdits(generated, incoming) {
  if (!Array.isArray(generated) || !generated.length) {
    throw new Error('This report has no stored sections to edit — it predates section storage or failed to generate');
  }
  if (!Array.isArray(incoming)) {
    throw new Error('Edits must be a list of sections');
  }

  const byId = new Map();
  for (const s of generated) {
    if (s && typeof s.id === 'string') byId.set(s.id, s);
  }

  const seen = new Set();
  const out = [];
  incoming.forEach((section, index) => {
    if (!isPlainObject(section)) {
      throw new Error(`Section ${index + 1} is not an object`);
    }
    const original = typeof section.id === 'string' ? byId.get(section.id) : undefined;
    if (!original) {
      out.push(newNoteSection(section, index));
      return;
    }
    if (seen.has(original.id)) {
      throw new Error(`Section ${original.id} appears twice`);
    }
    // A type that disagrees with the generated section is the payload trying
    // to render one kind of section with another's data.
    if (section.type !== undefined && section.type !== original.type) {
      throw new Error(
        `Section ${original.id} is a ${original.type} section; it cannot become a ${section.type}`
      );
    }
    seen.add(original.id);
    out.push(mergeSection(original, section));
  });

  // Every generated section has to come back, hidden or not. A payload that
  // simply omits one is a bug in the editor, and the quiet outcomes are the
  // bad ones: silently dropping a section from a client report, or reordering
  // the document around the gap. Removal is `hidden: true`.
  const missing = generated.filter(s => s && typeof s.id === 'string' && !seen.has(s.id)).map(s => s.id);
  if (missing.length) {
    throw new Error(
      `These sections were left out of the edit: ${missing.join(', ')}. `
      + 'Every generated section must be sent back; set hidden: true to drop one from the report.'
    );
  }

  return out;
}

// What the renderers should be given: the edited array when there is one, and
// without the sections somebody hid.
function visibleSections(sections) {
  return (Array.isArray(sections) ? sections : []).filter(s => s && !s.hidden);
}

// The array that represents this report now. Edits win; the generated original
// stays in summary.sections either way.
function effectiveSections(report) {
  if (!report) return [];
  if (Array.isArray(report.edited_sections) && report.edited_sections.length) {
    return report.edited_sections;
  }
  const summary = report.summary || {};
  return Array.isArray(summary.sections) ? summary.sections : [];
}

// Which section ids a human changed, and in what way. Used by the editor to
// mark edited blocks, and by the audit trail after the fact.
function diffSections(generated, edited) {
  const byId = new Map((generated || []).map(s => [s && s.id, s]));
  const changes = [];
  for (const section of edited || []) {
    if (!section) continue;
    const original = byId.get(section.id);
    if (!original) { changes.push({ id: section.id, change: 'added' }); continue; }
    if (section.hidden && !original.hidden) { changes.push({ id: section.id, change: 'hidden' }); continue; }
    const fields = (EDITABLE_BY_TYPE[original.type] || []).filter(field => {
      if (field === 'cells') {
        const a = original.cells || [];
        const b = section.cells || [];
        return a.some((cell, i) => EDITABLE_CELL_FIELDS.some(f => (b[i] || {})[f] !== cell[f]));
      }
      return (section[field] || '') !== (original[field] || '');
    });
    if (fields.length) changes.push({ id: section.id, change: 'edited', fields });
  }
  return changes;
}

module.exports = {
  mergeEdits,
  visibleSections,
  effectiveSections,
  diffSections,
  _internals: { EDITABLE_BY_TYPE, EDITABLE_CELL_FIELDS, LIMITS, ADDABLE_TYPES, cleanText, mergeCells },
};
