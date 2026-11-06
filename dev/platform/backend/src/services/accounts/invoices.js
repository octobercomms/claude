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
            drive_file_id, drive_file_name, drive_file_url, match_confidence, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'matched')
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

function findBestMatch(queueItem, driveFiles) {
  const payee = (queueItem.payee || '').toLowerCase();
  const amount = Math.abs(parseFloat(queueItem.amount) || 0);
  const amountStr = amount.toFixed(2);

  let best = null;
  let bestScore = 0;

  for (const file of driveFiles) {
    const name = (file.name || '').toLowerCase();
    let score = 0;

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

module.exports = {
  matchInvoicesToQueue,
  attachToXero,
  getInvoiceStats,
  getMissingInvoices,
};
