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

const fs = require('fs');
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
// thumbnailLink, webViewLink, width, height, aspect_ratio, duration_ms }.
// Dimensions are extracted from Drive's video/imageMediaMetadata so the
// UI can warn when a file won't fit the target platform's frame.
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
      fields: 'files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink,webContentLink,videoMediaMetadata(width,height,durationMillis),imageMediaMetadata(width,height))',
      orderBy: 'modifiedTime desc',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    },
  });
  return (data.files || []).map(f => {
    const meta = f.videoMediaMetadata || f.imageMediaMetadata || null;
    const width = meta?.width || null;
    const height = meta?.height || null;
    const aspect = (width && height) ? Math.round((width / height) * 1000) / 1000 : null;
    return {
      ...f,
      width, height,
      aspect_ratio: aspect,
      duration_ms: f.videoMediaMetadata?.durationMillis ? parseInt(f.videoMediaMetadata.durationMillis, 10) : null,
    };
  });
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

// Upload a local file into a Drive folder (resumable: init → PUT the bytes).
// Used by Video Studio delivery. Needs the drive.file scope — tokens that
// predate it must re-authorise. Returns { id, webViewLink }.
async function uploadFile(clientId, { name, mimeType = 'video/mp4', filePath, folderInput }) {
  const folderId = parseFolderId(folderInput);
  if (!folderId) throw new Error('Invalid Drive folder — paste the full folder URL from Drive.');
  if (!fs.existsSync(filePath)) throw new Error('File to upload not found on disk.');
  const creds = await getGoogleCreds(clientId);

  const init = await axios.post(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink',
    { name, parents: [folderId] },
    { headers: { Authorization: `Bearer ${creds.access_token}`, 'Content-Type': 'application/json' } }
  );
  const uploadUrl = init.headers.location;
  if (!uploadUrl) throw new Error('Drive did not return an upload URL.');

  const size = fs.statSync(filePath).size;
  const { data } = await axios.put(uploadUrl, fs.createReadStream(filePath), {
    headers: { 'Content-Type': mimeType, 'Content-Length': size },
    maxBodyLength: Infinity, maxContentLength: Infinity,
  });
  return { id: data?.id || null, webViewLink: data?.webViewLink || null };
}

module.exports = { parseFolderId, parseFileId, listFolder, downloadFile, uploadFile };
