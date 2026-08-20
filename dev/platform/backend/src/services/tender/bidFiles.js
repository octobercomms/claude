// Files uploaded into a tender's bid workspace. Bytes on disk under
// uploads/tenders/<notice_id>/, metadata in tender_bid_files. Also turns the
// files into Anthropic content blocks so the chat can read them (PDF + images
// natively; text files inlined; other types are listed but not sent).

const fs = require('fs');
const path = require('path');
const pool = require('../../db');

const ROOT = path.join(__dirname, '../../../uploads', 'tenders');
function dirFor(noticeId) {
  const dir = path.join(ROOT, String(noticeId).replace(/[^a-z0-9-]/gi, ''));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function record(noticeId, { filename, stored_name, mime, size_bytes }) {
  const { rows } = await pool.query(
    `INSERT INTO tender_bid_files (notice_id, filename, stored_name, mime, size_bytes)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, filename, mime, size_bytes, created_at`,
    [noticeId, filename, stored_name, mime || null, size_bytes || null]
  );
  return rows[0];
}

async function list(noticeId) {
  const { rows } = await pool.query(
    'SELECT id, filename, mime, size_bytes, created_at FROM tender_bid_files WHERE notice_id = $1 ORDER BY created_at ASC',
    [noticeId]
  );
  return rows;
}

async function getRow(fileId) {
  const { rows } = await pool.query('SELECT * FROM tender_bid_files WHERE id = $1', [fileId]);
  return rows[0] || null;
}

async function remove(fileId) {
  const row = await getRow(fileId);
  if (!row) return false;
  try { fs.unlinkSync(path.join(dirFor(row.notice_id), row.stored_name)); } catch { /* already gone */ }
  await pool.query('DELETE FROM tender_bid_files WHERE id = $1', [fileId]);
  return true;
}

// Turn the notice's files into Anthropic content blocks for the chat. Capped so
// a big pile of attachments can't blow the context — most recent first.
async function contentBlocks(noticeId, { maxFiles = 6, maxTextChars = 20000 } = {}) {
  const rows = (await list(noticeId)).slice(-maxFiles);
  const dir = dirFor(noticeId);
  const blocks = [];
  const skipped = [];
  for (const r of rows) {
    const fp = path.join(dir, r.stored_name);
    let buf;
    try { buf = fs.readFileSync(fp); } catch { continue; }
    const mime = r.mime || '';
    if (mime === 'application/pdf') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
    } else if (/^image\/(png|jpe?g|gif|webp)$/.test(mime)) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: mime === 'image/jpg' ? 'image/jpeg' : mime, data: buf.toString('base64') } });
    } else if (/^text\/|json|csv|markdown/.test(mime) || /\.(txt|md|csv)$/i.test(r.filename)) {
      blocks.push({ type: 'text', text: `Attached file "${r.filename}":\n"""\n${buf.toString('utf8').slice(0, maxTextChars)}\n"""` });
    } else {
      skipped.push(r.filename);
    }
  }
  return { blocks, skipped };
}

module.exports = { dirFor, record, list, getRow, remove, contentBlocks, ROOT };
