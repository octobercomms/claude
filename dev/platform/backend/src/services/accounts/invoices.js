// Invoice matching: Google Drive files to Xero bank lines.
//
// Scans the configured Google Drive folder for invoice/receipt files,
// matches them to unreconciled Xero transactions by amount, date and payee,
// and (on confirmation) attaches them to the Xero transaction.

const db = require('../../db');
const xero = require('../../connectors/xero');

// Match invoices from the Drive listing against reconcile queue items.
// driveFiles: [{ id, name, url, mimeType, modifiedTime }] from the Google Drive API.
async function matchInvoicesToQueue(driveFiles) {
  if (!driveFiles || !driveFiles.length) return { matched: 0, missing: 0 };

  const { rows: queueItems } = await db.query(
    `SELECT * FROM acct_reconcile_queue WHERE status IN ('pending', 'confirmed') ORDER BY line_date DESC`
  );

  let matched = 0;
  let missing = 0;

  for (const item of queueItems) {
    // Check if already matched.
    const { rows: existing } = await db.query(
      'SELECT id FROM acct_invoice_matches WHERE line_ref = $1 AND status != $2',
      [item.line_ref, 'missing']
    );
    if (existing.length) continue;

    // Try to find a matching Drive file by name or amount.
    const match = findBestMatch(item, driveFiles);

    if (match) {
      await db.query(
        `INSERT INTO acct_invoice_matches
           (line_ref, xero_contact, invoice_date, amount, currency,
            drive_file_id, drive_file_name, drive_file_url, match_confidence, status,
            drive_folder_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'matched', $10)
         ON CONFLICT DO NOTHING`,
        [
          item.line_ref,
          item.payee,
          item.line_date,
          item.amount,
          item.currency,
          match.id,
          match.name,
          match.url || null,
          match.confidence,
          match.folderPath || null,
        ]
      );
      matched++;
    } else {
      await db.query(
        `INSERT INTO acct_invoice_matches
           (line_ref, xero_contact, invoice_date, amount, currency, status)
         VALUES ($1, $2, $3, $4, $5, 'missing')
         ON CONFLICT DO NOTHING`,
        [item.line_ref, item.payee, item.line_date, item.amount, item.currency]
      );
      missing++;
    }
  }

  return { matched, missing };
}

function extractSupplierFromPath(folderPath) {
  if (!folderPath) return null;
  const parts = folderPath.split('/');
  if (parts.length < 2) return null;
  const name = parts[1].trim();
  return name.length >= 2 ? name.toLowerCase() : null;
}

function findBestMatch(queueItem, driveFiles) {
  const payee = (queueItem.payee || '').toLowerCase();
  const amount = Math.abs(parseFloat(queueItem.amount) || 0);
  const amountStr = amount.toFixed(2);

  let best = null;
  let bestScore = 0;

  for (const file of driveFiles) {
    const name = (file.name || '').toLowerCase();
    let score = 0;

    // Folder path names the supplier. A file in "2024-2025/Adobe" matching
    // a payee containing "adobe" is a strong prior before any filename parsing.
    const folderSupplier = extractSupplierFromPath(file.folderPath);
    if (folderSupplier && payee.includes(folderSupplier)) {
      score += 0.4;
    }

    // Amount in filename is a strong signal.
    if (name.includes(amountStr) || name.includes(amount.toFixed(0))) {
      score += 0.5;
    }

    // Payee name in filename.
    if (payee && payee.length > 2) {
      const words = payee.split(/\s+/).filter(w => w.length > 2);
      const payeeMatches = words.filter(w => name.includes(w)).length;
      if (payeeMatches > 0) score += 0.3 * (payeeMatches / words.length);
    }

    // Date proximity.
    if (queueItem.line_date && file.modifiedTime) {
      const lineDateMs = new Date(queueItem.line_date).getTime();
      const fileDateMs = new Date(file.modifiedTime).getTime();
      const daysDiff = Math.abs(lineDateMs - fileDateMs) / (1000 * 60 * 60 * 24);
      if (daysDiff < 7) score += 0.2;
      else if (daysDiff < 30) score += 0.1;
    }

    if (score > bestScore && score >= 0.3) {
      best = { ...file, confidence: Math.min(score, 1.0) };
      bestScore = score;
    }
  }

  return best;
}

// Attach a matched invoice file to its Xero transaction.
async function attachToXero(matchId, fileBuffer, filename, contentType) {
  const { rows } = await db.query('SELECT * FROM acct_invoice_matches WHERE id = $1', [matchId]);
  if (!rows.length) throw new Error('Invoice match not found');
  const match = rows[0];

  const token = await xero.getValidToken();
  const result = await xero.attachFile(
    token,
    'BankTransactions',
    match.line_ref,
    filename || match.drive_file_name,
    fileBuffer,
    contentType || 'application/pdf'
  );

  await db.query(
    `UPDATE acct_invoice_matches SET attached_to_xero = true, status = 'attached',
     xero_attachment_id = $1, updated_at = now() WHERE id = $2`,
    [result.Attachments?.[0]?.AttachmentID || null, matchId]
  );

  return result;
}

// Stats for the dashboard.
async function getInvoiceStats() {
  const { rows } = await db.query(`
    SELECT status, count(*)::int as count
    FROM acct_invoice_matches
    GROUP BY status
  `);
  const stats = { pending: 0, matched: 0, attached: 0, missing: 0, manual: 0 };
  for (const r of rows) stats[r.status] = r.count;
  return stats;
}

async function getMissingInvoices() {
  const { rows } = await db.query(
    `SELECT * FROM acct_invoice_matches WHERE status = 'missing' ORDER BY invoice_date DESC`
  );
  return rows;
}

async function getAllInvoices(opts = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (opts.quarter) {
    // quarter format: "2026-Q3" meaning Jul-Sep 2026
    const m = opts.quarter.match(/^(\d{4})-Q([1-4])$/);
    if (m) {
      const year = parseInt(m[1]);
      const q = parseInt(m[2]);
      const startMonth = (q - 1) * 3; // 0-based: Q1=0, Q2=3, Q3=6, Q4=9
      const start = new Date(year, startMonth, 1);
      const end = new Date(year, startMonth + 3, 1);
      conditions.push(`invoice_date >= $${idx}`);
      params.push(start.toISOString().split('T')[0]);
      idx++;
      conditions.push(`invoice_date < $${idx}`);
      params.push(end.toISOString().split('T')[0]);
      idx++;
    }
  }

  if (opts.status) {
    conditions.push(`status = $${idx}`);
    params.push(opts.status);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT * FROM acct_invoice_matches ${where} ORDER BY invoice_date DESC, id DESC`,
    params
  );
  return rows;
}

module.exports = {
  matchInvoicesToQueue,
  findBestMatch,
  attachToXero,
  getInvoiceStats,
  getMissingInvoices,
  getAllInvoices,
};
