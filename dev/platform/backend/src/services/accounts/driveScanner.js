// Google Drive invoice/receipt scanner for the Accounts module.
//
// Reads PDF and image files from a configured Drive folder (set via
// ACCOUNTS_DRIVE_FOLDER_ID or ACCOUNTS_DRIVE_FOLDER_URL env var) using
// the platform's Google service account. Files are matched against the
// reconcile queue by the invoices service and optionally attached to
// Xero transactions.
//
// The service account must be granted Viewer access on the target folder
// in Google Drive (share the folder with the service-account email).

const axios = require('axios');
const { getPlatformGoogleAccessToken, getServiceAccountEmail } = require('../googleAuth');
const invoices = require('./invoices');

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const INVOICE_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
];

const FOLDER_ID_RE = /\/folders\/([a-zA-Z0-9_-]+)/;

function parseFolderId(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(FOLDER_ID_RE);
  return m ? m[1] : null;
}

function getFolderId() {
  const raw = process.env.ACCOUNTS_DRIVE_FOLDER_ID || process.env.ACCOUNTS_DRIVE_FOLDER_URL;
  if (!raw) return null;
  return parseFolderId(raw);
}

async function getToken() {
  return getPlatformGoogleAccessToken(['https://www.googleapis.com/auth/drive.readonly']);
}

async function listInvoiceFiles(folderId, pageToken) {
  const token = await getToken();
  const mimeFilter = INVOICE_MIME_TYPES.map(m => `mimeType = '${m}'`).join(' or ');
  const q = `'${folderId}' in parents and trashed = false and (${mimeFilter})`;

  const { data } = await axios.get(`${DRIVE_API}/files`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      q,
      fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,webContentLink)',
      orderBy: 'modifiedTime desc',
      pageSize: 200,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      ...(pageToken ? { pageToken } : {}),
    },
  });

  return {
    files: (data.files || []).map(f => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size ? parseInt(f.size, 10) : null,
      modifiedTime: f.modifiedTime,
      url: f.webViewLink || null,
      webContentLink: f.webContentLink || null,
    })),
    nextPageToken: data.nextPageToken || null,
  };
}

// Fetch all invoice files from the configured folder (paginated).
async function getAllInvoiceFiles(folderId) {
  const all = [];
  let pageToken = null;
  do {
    const page = await listInvoiceFiles(folderId, pageToken);
    all.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return all;
}

// Download a single file's bytes. Returns { data: Buffer, contentType }.
async function downloadFile(fileId) {
  const token = await getToken();
  const res = await axios.get(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { alt: 'media', supportsAllDrives: true },
    responseType: 'arraybuffer',
  });
  return {
    data: Buffer.from(res.data),
    contentType: res.headers['content-type'] || 'application/pdf',
  };
}

// Full scan: list Drive files, match against reconcile queue, return stats.
async function scanAndMatch() {
  const folderId = getFolderId();
  if (!folderId) {
    return {
      error: 'No invoice folder configured. Set ACCOUNTS_DRIVE_FOLDER_ID or ACCOUNTS_DRIVE_FOLDER_URL in Settings > Environment.',
      scanned: 0,
      matched: 0,
      missing: 0,
    };
  }

  const files = await getAllInvoiceFiles(folderId);
  const result = await invoices.matchInvoicesToQueue(files);

  return {
    scanned: files.length,
    matched: result.matched,
    missing: result.missing,
    folderId,
  };
}

// Download a matched invoice and attach it to Xero.
async function attachMatchedInvoice(matchId) {
  const db = require('../../db');
  const { rows } = await db.query('SELECT * FROM acct_invoice_matches WHERE id = $1', [matchId]);
  if (!rows.length) throw new Error('Invoice match not found');
  const match = rows[0];

  if (!match.drive_file_id) {
    throw new Error('No Drive file linked to this match');
  }

  const { data, contentType } = await downloadFile(match.drive_file_id);
  const result = await invoices.attachToXero(matchId, data, match.drive_file_name, contentType);
  return result;
}

// Status check: is the folder configured? Is the service account able to read it?
async function checkStatus() {
  const folderId = getFolderId();
  const email = getServiceAccountEmail();

  if (!folderId) {
    return {
      configured: false,
      folderId: null,
      serviceAccountEmail: email,
      message: 'Set ACCOUNTS_DRIVE_FOLDER_ID or ACCOUNTS_DRIVE_FOLDER_URL in Settings > Environment, then share the folder with the service account email.',
    };
  }

  try {
    const token = await getToken();
    const { data } = await axios.get(`${DRIVE_API}/files/${encodeURIComponent(folderId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { fields: 'id,name,mimeType', supportsAllDrives: true },
    });

    return {
      configured: true,
      folderId,
      folderName: data.name,
      serviceAccountEmail: email,
      accessible: true,
    };
  } catch (err) {
    return {
      configured: true,
      folderId,
      serviceAccountEmail: email,
      accessible: false,
      error: err.response?.status === 404
        ? 'Folder not found. Check the ID and ensure the folder is shared with the service account.'
        : err.message,
    };
  }
}

module.exports = {
  scanAndMatch,
  attachMatchedInvoice,
  downloadFile,
  checkStatus,
  getAllInvoiceFiles,
  getFolderId,
};
