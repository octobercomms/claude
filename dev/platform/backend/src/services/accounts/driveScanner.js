// Google Drive invoice/receipt scanner for the Accounts module.
//
// Recursively scans subfolders under the configured root Drive folder,
// with per-subfolder include/exclude toggles stored in acct_drive_subfolders.
// Files are matched against the reconcile queue by the invoices service
// and optionally attached to Xero transactions.

const axios = require('axios');
const { getPlatformGoogleAccessToken, getServiceAccountEmail } = require('../googleAuth');
const invoices = require('./invoices');
const db = require('../../db');

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

// ---------------------------------------------------------------------------
// Subfolder discovery
// ---------------------------------------------------------------------------

async function listChildFolders(parentId, token) {
  const q = `'${parentId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`;
  const all = [];
  let pageToken = null;
  do {
    const { data } = await axios.get(`${DRIVE_API}/files`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        q,
        fields: 'nextPageToken,files(id,name)',
        pageSize: 200,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        ...(pageToken ? { pageToken } : {}),
      },
    });
    all.push(...(data.files || []));
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return all;
}

async function discoverSubfolders(rootFolderId) {
  const token = await getToken();
  const found = [];

  async function walk(parentId, parentPath) {
    const children = await listChildFolders(parentId, token);
    for (const child of children) {
      const path = parentPath ? `${parentPath}/${child.name}` : child.name;
      found.push({ id: child.id, name: child.name, path, parentId });
      await walk(child.id, path);
    }
  }

  await walk(rootFolderId, '');

  for (const f of found) {
    await db.query(
      `INSERT INTO acct_drive_subfolders (drive_folder_id, parent_id, name, path)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (drive_folder_id) DO UPDATE
         SET name = EXCLUDED.name, path = EXCLUDED.path, parent_id = EXCLUDED.parent_id, updated_at = NOW()`,
      [f.id, f.parentId, f.name, f.path]
    );
  }

  const { rows } = await db.query(
    'SELECT drive_folder_id, name, path, included, file_count, last_scanned_at FROM acct_drive_subfolders ORDER BY path'
  );
  return rows;
}

async function getSubfolders() {
  const { rows } = await db.query(
    'SELECT drive_folder_id, name, path, included, file_count, last_scanned_at FROM acct_drive_subfolders ORDER BY path'
  );
  return rows;
}

async function getIncludedFolders() {
  const { rows } = await db.query(
    'SELECT drive_folder_id, name, path FROM acct_drive_subfolders WHERE included = true ORDER BY path'
  );
  return rows;
}

async function toggleSubfolder(driveFolderId, included) {
  const { rows } = await db.query(
    `UPDATE acct_drive_subfolders SET included = $2, updated_at = NOW()
     WHERE drive_folder_id = $1
     RETURNING drive_folder_id AS id, name, path, included, file_count`,
    [driveFolderId, included]
  );
  if (!rows.length) throw new Error('Subfolder not found');
  return rows[0];
}

// ---------------------------------------------------------------------------
// File listing (recursive)
// ---------------------------------------------------------------------------

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

async function listAllFilesInFolder(folderId) {
  const all = [];
  let pageToken = null;
  do {
    const page = await listInvoiceFiles(folderId, pageToken);
    all.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return all;
}

async function listInvoiceFilesRecursive(folderIds, folderPathMap) {
  const all = [];
  for (const fid of folderIds) {
    const files = await listAllFilesInFolder(fid);
    const folderPath = folderPathMap[fid] || null;
    for (const f of files) {
      all.push({ ...f, folderPath });
    }
  }
  return all;
}

async function getAllInvoiceFiles(folderId) {
  const included = await getIncludedFolders();

  if (included.length > 0) {
    const folderPathMap = {};
    for (const sf of included) folderPathMap[sf.drive_folder_id] = sf.path;
    folderPathMap[folderId] = null;

    const folderIds = [folderId, ...included.map(sf => sf.drive_folder_id)];
    const files = await listInvoiceFilesRecursive(folderIds, folderPathMap);

    // Update file counts per subfolder.
    const counts = {};
    for (const f of files) {
      const key = f.folderPath || '__root__';
      counts[key] = (counts[key] || 0) + 1;
    }
    for (const sf of included) {
      const cnt = counts[sf.path] || 0;
      await db.query(
        'UPDATE acct_drive_subfolders SET file_count = $1, last_scanned_at = NOW() WHERE drive_folder_id = $2',
        [cnt, sf.id]
      );
    }

    return files;
  }

  // No subfolders discovered yet: flat listing for backward compat.
  const files = await listAllFilesInFolder(folderId);
  return files.map(f => ({ ...f, folderPath: null }));
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Scan and match
// ---------------------------------------------------------------------------

async function scanAndMatch() {
  const folderId = getFolderId();
  if (!folderId) {
    return {
      error: 'No invoice folder configured.',
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

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

async function checkStatus() {
  const folderId = getFolderId();
  const email = getServiceAccountEmail();

  if (!folderId) {
    return {
      configured: false,
      folderId: null,
      serviceAccountEmail: email,
      message: 'Configure an invoice folder on the Drive panel, then share it with the service account.',
    };
  }

  try {
    const token = await getToken();
    const { data } = await axios.get(`${DRIVE_API}/files/${encodeURIComponent(folderId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { fields: 'id,name,mimeType', supportsAllDrives: true },
    });

    let subfolders = [];
    try {
      subfolders = await getSubfolders();
    } catch (_) { /* subfolders are best-effort in status */ }

    // Count files across included subfolders + root loose files.
    let fileCount = null;
    try {
      const mimeFilter = INVOICE_MIME_TYPES.map(m => `mimeType = '${m}'`).join(' or ');
      const rootQ = `'${folderId}' in parents and trashed = false and (${mimeFilter})`;
      const countRes = await axios.get(`${DRIVE_API}/files`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { q: rootQ, fields: 'files(id)', pageSize: 1000, supportsAllDrives: true, includeItemsFromAllDrives: true },
      });
      const rootCount = (countRes.data.files || []).length;
      const subCount = subfolders
        .filter(s => s.included && s.file_count != null)
        .reduce((sum, s) => sum + s.file_count, 0);
      fileCount = rootCount + subCount;
    } catch (_) { /* file count is best-effort */ }

    return {
      configured: true,
      folderId,
      folderName: data.name,
      fileCount,
      subfolders,
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
  discoverSubfolders,
  getSubfolders,
  getIncludedFolders,
  toggleSubfolder,
};
