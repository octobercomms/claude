// Email invoice scanner for the Accounts module.
//
// A first-class invoice source alongside Google Drive. Scans mailboxes that
// have scan_invoices enabled, extracts PDF/image attachments, and feeds them
// into the same matching engine Drive uses. Matched invoices are attached to
// Xero and filed into OC Expenses so the Drive archive self-heals.

const axios = require('axios');
const db = require('../../db');
const inboxes = require('../outreachInboxes');
const invoices = require('./invoices');
const { getPlatformGoogleAccessToken } = require('../googleAuth');

const LOOKBACK_DAYS = parseInt(process.env.ACCOUNTS_EMAIL_LOOKBACK_DAYS, 10) || 90;

const INVOICE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
]);

const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

// ---------------------------------------------------------------------------
// Single mailbox scan
// ---------------------------------------------------------------------------

async function scanMailbox(inbox) {
  const mimeAttachments = require('../mimeAttachments');
  const attachments = [];
  let scanned = 0;
  let errors = 0;

  let client;
  try {
    client = await inboxes.imapClient(inbox);
    await client.connect();
  } catch (err) {
    await inboxes.recordState(inbox.id, {
      last_run_at: new Date(),
      last_error: `Invoice scan connect failed: ${err.message}`,
    });
    return { attachments: [], scanned: 0, errors: 1 };
  }

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const uids = await client.search({ since }, { uid: true });
      if (!uids || !uids.length) {
        return { attachments: [], scanned: 0, errors: 0 };
      }

      for await (const msg of client.fetch(uids, { envelope: true, source: true }, { uid: true })) {
        scanned++;
        try {
          if (!msg.source) continue;
          const raw = msg.source.toString('utf8');
          const parts = mimeAttachments.extractAttachments(raw);
          if (!parts.length) continue;

          const from = msg.envelope?.from?.[0];
          const emailFrom = from?.address ? from.address.toLowerCase().trim() : '';
          const subject = msg.envelope?.subject ? String(msg.envelope.subject) : '';
          const date = msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : null;

          for (const part of parts) {
            if (!INVOICE_MIME_TYPES.has(part.contentType)) continue;
            attachments.push({
              filename: part.filename,
              contentType: part.contentType,
              data: part.data,
              size: part.data.length,
              emailFrom,
              emailSubject: subject,
              emailDate: date,
              mailboxId: inbox.id,
              mailboxLabel: inbox.label,
              uid: msg.uid,
            });
          }
        } catch (partErr) {
          errors++;
          console.warn('[EmailScanner]', inbox.label, 'message parse error:', partErr.message);
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    errors++;
    console.error('[EmailScanner]', inbox.label, 'scan error:', err.message);
    await inboxes.recordState(inbox.id, {
      last_run_at: new Date(),
      last_error: `Invoice scan: ${err.message}`,
    });
  } finally {
    await client.logout().catch(() => {});
  }

  await inboxes.recordState(inbox.id, {
    last_run_at: new Date(),
    last_error: errors ? `Invoice scan: ${errors} parse error(s)` : null,
  });

  return { attachments, scanned, errors };
}

// ---------------------------------------------------------------------------
// Match email attachments against the reconcile queue
// ---------------------------------------------------------------------------

function toFileShape(attachments) {
  return attachments.map((a, i) => ({
    id: `email-${a.mailboxId}-${a.uid}-${i}`,
    name: a.filename,
    mimeType: a.contentType,
    size: a.size,
    modifiedTime: a.emailDate,
    url: null,
    folderPath: null,
    source: 'email',
    emailFrom: a.emailFrom,
    emailSubject: a.emailSubject,
    _attachment: a,
  }));
}

async function matchEmailAttachments(attachments) {
  if (!attachments.length) return { matched: 0, missing: 0 };
  const files = toFileShape(attachments);
  return invoices.matchInvoicesToQueue(files);
}

// ---------------------------------------------------------------------------
// File an email-sourced invoice to the OC Expenses Drive folder
// ---------------------------------------------------------------------------

async function fileToDrive(buffer, filename, contentType, targetFolderId) {
  const token = await getPlatformGoogleAccessToken([
    'https://www.googleapis.com/auth/drive.file',
  ]);

  const initRes = await axios.post(
    `${DRIVE_UPLOAD_API}?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink`,
    { name: filename, parents: [targetFolderId] },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );

  const uploadUrl = initRes.headers.location;
  const { data } = await axios.put(uploadUrl, buffer, {
    headers: { 'Content-Type': contentType },
    maxBodyLength: 50 * 1024 * 1024,
  });

  return { fileId: data.id, webViewLink: data.webViewLink };
}

async function resolveSupplierFolder(folderId, supplierName) {
  if (!supplierName) return folderId;

  const token = await getPlatformGoogleAccessToken([
    'https://www.googleapis.com/auth/drive.readonly',
  ]);

  const now = new Date();
  const fiscalYear = now.getMonth() >= 3
    ? `${now.getFullYear()}-${now.getFullYear() + 1}`
    : `${now.getFullYear() - 1}-${now.getFullYear()}`;

  const yearQ = `'${folderId}' in parents and name = '${fiscalYear}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const { data: yearData } = await axios.get(`${DRIVE_API}/files`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { q: yearQ, fields: 'files(id,name)', supportsAllDrives: true, includeItemsFromAllDrives: true },
  });

  const yearFolder = (yearData.files || [])[0];
  if (!yearFolder) return folderId;

  const supplierQ = `'${yearFolder.id}' in parents and name = '${supplierName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const { data: supplierData } = await axios.get(`${DRIVE_API}/files`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { q: supplierQ, fields: 'files(id,name)', supportsAllDrives: true, includeItemsFromAllDrives: true },
  });

  const supplierFolder = (supplierData.files || [])[0];
  return supplierFolder ? supplierFolder.id : yearFolder.id;
}

// Attach a matched email invoice to Xero and file to Drive.
async function attachAndFile(matchId, attachment, folderId) {
  const result = await invoices.attachToXero(
    matchId,
    attachment.data,
    attachment.filename,
    attachment.contentType
  );

  let filed = null;
  if (folderId) {
    try {
      const supplierName = await getMatchSupplier(matchId);
      const targetFolder = await resolveSupplierFolder(folderId, supplierName);
      filed = await fileToDrive(
        attachment.data,
        attachment.filename,
        attachment.contentType,
        targetFolder
      );

      await db.query(
        `UPDATE acct_invoice_matches
         SET drive_file_id = $1, drive_file_url = $2, updated_at = now()
         WHERE id = $3`,
        [filed.fileId, filed.webViewLink, matchId]
      );
    } catch (driveErr) {
      console.warn('[EmailScanner] Filed to Xero but Drive copy failed:', driveErr.message);
      filed = { error: driveErr.message };
    }
  }

  return { xero: result, filed };
}

async function getMatchSupplier(matchId) {
  const { rows } = await db.query(
    'SELECT xero_contact FROM acct_invoice_matches WHERE id = $1',
    [matchId]
  );
  return rows[0]?.xero_contact || null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function scanInboxesForInvoices() {
  const allInboxes = await inboxes.activeWithCredentials();
  const invoiceInboxes = allInboxes.filter(i => i.scan_invoices === true);

  if (!invoiceInboxes.length) {
    return {
      scannedMailboxes: 0,
      totalEmails: 0,
      attachmentsFound: 0,
      matched: 0,
      errors: 0,
      note: 'No mailboxes have scan_invoices enabled.',
    };
  }

  let totalEmails = 0;
  let totalAttachments = 0;
  let totalErrors = 0;
  const allAttachments = [];

  for (const inbox of invoiceInboxes) {
    console.log('[EmailScanner] Scanning', inbox.label, '...');
    const result = await scanMailbox(inbox);
    totalEmails += result.scanned;
    totalAttachments += result.attachments.length;
    totalErrors += result.errors;
    allAttachments.push(...result.attachments);
  }

  const matchResult = await matchEmailAttachments(allAttachments);

  return {
    scannedMailboxes: invoiceInboxes.length,
    totalEmails,
    attachmentsFound: totalAttachments,
    matched: matchResult.matched,
    missing: matchResult.missing,
    errors: totalErrors,
  };
}

// Scan a single mailbox on demand (for "Read now" button).
async function scanSingleInbox(inboxId) {
  const inbox = await inboxes.withCredentials(inboxId);
  if (!inbox) throw new Error('Mailbox not found');

  const result = await scanMailbox(inbox);
  const matchResult = await matchEmailAttachments(result.attachments);

  return {
    scanned: result.scanned,
    attachmentsFound: result.attachments.length,
    matched: matchResult.matched,
    errors: result.errors,
  };
}

module.exports = {
  scanInboxesForInvoices,
  scanSingleInbox,
  scanMailbox,
  matchEmailAttachments,
  attachAndFile,
  fileToDrive,
};
