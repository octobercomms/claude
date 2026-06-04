// Read media files from a Google Drive folder for the social autopilot.
// Used by Phase 2 (preview what's in the folder + generate captions)
// and Phase 3 (download the media at publish time and hand it to the
// Meta / LinkedIn APIs).
//
// We reuse the existing Google OAuth that the AM already authorised for
// GA4 / Search Console / Ads — drive.readonly was added to the scope
// list in PR with this code. Anyone whose token predates that change
// will need to re-authorise; the diagnose panel surfaces the missing
// scope.

const axios = require('axios');
const pool = require('../db');
const { decrypt } = require('../utils/encryption');
const googleConnector = require('../connectors/google');

const FOLDER_ID_RE = /\/folders\/([a-zA-Z0-9_-]+)/;
const FILE_ID_RE = /\/file\/d\/([a-zA-Z0-9_-]+)/;

function parseFolderId(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  // Bare ID?
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(FOLDER_ID_RE);
  return m ? m[1] : null;
}

function parseFileId(input) {
  const m = String(input || '').match(FILE_ID_RE);
  return m ? m[1] : null;
}

// Find an active Google connector on this client and return refreshed
// credentials. Any of the Google connectors (ga4 / google_search_console
// / google_ads / google_merchant_center) will do — they all share the
// OAuth token now that drive.readonly is part of the scope set.
async function getGoogleCreds(clientId) {
  const { rows } = await pool.query(
    `SELECT credentials FROM connectors
      WHERE client_id = $1
        AND connector_type IN ('ga4','google_search_console','google_ads','google_merchant_center')
        AND credentials IS NOT NULL
        AND credentials != '{}'
      ORDER BY connector_type
      LIMIT 1`,
    [clientId]
  );
  if (!rows.length) throw new Error('No Google connector on this client — connect GA4 / Search Console / Ads first.');
  const creds = decrypt(rows[0].credentials);
  // Refresh if near-expiry so the caller doesn't have to.
  if (!creds.expires_at || Date.now() > creds.expires_at - 60_000) {
    return googleConnector.refreshToken(creds);
  }
  return creds;
}

// List media files (image + video) in a folder. Returns up to 100 most
// recently modified. Each item: { id, name, mimeType, size, modifiedTime,
// thumbnailLink, webViewLink }.
async function listFolder(clientId, folderInput) {
  const folderId = parseFolderId(folderInput);
  if (!folderId) throw new Error('Invalid Drive folder URL — paste the full URL from Drive (https://drive.google.com/drive/folders/...).');
  const creds = await getGoogleCreds(clientId);
  // mimeType filter — only video + image. trashed=false to skip the bin.
  const q = `'${folderId}' in parents and trashed = false and (mimeType contains 'video/' or mimeType contains 'image/')`;
  const { data } = await axios.get('https://www.googleapis.com/drive/v3/files', {
    headers: { Authorization: `Bearer ${creds.access_token}` },
    params: {
      q,
      fields: 'files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink,webContentLink)',
      orderBy: 'modifiedTime desc',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    },
  });
  return data.files || [];
}

// Stream a single file's bytes. Used by Phase 3 to feed Meta / LinkedIn
// at publish time. Caller pipes the response to wherever it needs.
async function downloadFile(clientId, fileId) {
  const creds = await getGoogleCreds(clientId);
  const res = await axios.get(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${creds.access_token}` },
    responseType: 'stream',
  });
  return res;
}

module.exports = { parseFolderId, parseFileId, listFolder, downloadFile };
