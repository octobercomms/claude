const db = require('../../db');
const { encrypt, decrypt } = require('../../utils/encryption');

const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';

const SCOPES = [
  'offline_access',
  'accounting.banktransactions',
  'accounting.attachments',
  'accounting.contacts.read',
  'accounting.settings.read',
  'accounting.reports.trialbalance.read',
  'accounting.reports.taxreports.read',
  'accounting.reports.profitandloss.read',
  'accounting.reports.balancesheet.read',
].join(' ');

async function getXeroCredentials() {
  const { rows } = await db.query(
    "SELECT key, value FROM platform_settings WHERE key = ANY($1)",
    [['XERO_CLIENT_ID', 'XERO_CLIENT_SECRET']]
  );
  const creds = {};
  for (const row of rows) {
    try { creds[row.key] = decrypt(JSON.parse(row.value)); } catch { /* skip */ }
  }
  if (!creds.XERO_CLIENT_ID || !creds.XERO_CLIENT_SECRET) {
    throw new Error('Xero credentials not configured. Add XERO_CLIENT_ID and XERO_CLIENT_SECRET in Settings > Accounts > Xero.');
  }
  return creds;
}

function getRedirectUri() {
  const base = process.env.PLATFORM_URL || process.env.BASE_URL || 'http://localhost:3001';
  return `${base}/api/accounts/xero/callback`;
}

async function getAuthUrl() {
  const { XERO_CLIENT_ID } = await getXeroCredentials();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: XERO_CLIENT_ID,
    redirect_uri: getRedirectUri(),
    scope: SCOPES,
    state: require('crypto').randomBytes(16).toString('hex'),
  });
  return `${XERO_AUTH_URL}?${params}`;
}

async function exchangeCode(code) {
  const { XERO_CLIENT_ID, XERO_CLIENT_SECRET } = await getXeroCredentials();
  const basic = Buffer.from(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`).toString('base64');

  const res = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectUri(),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Xero token exchange failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function storeTokens(tokenData) {
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  const connRes = await fetch(XERO_CONNECTIONS_URL, {
    headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
  });
  if (!connRes.ok) throw new Error('Failed to fetch Xero connections');
  const connections = await connRes.json();
  if (!connections.length) throw new Error('No Xero tenants found');

  const tenant = connections[0];

  const accessEnc = encrypt(tokenData.access_token);
  const refreshEnc = encrypt(tokenData.refresh_token);

  await db.query(`
    INSERT INTO acct_xero_connection (tenant_id, tenant_name, access_token, refresh_token, expires_at, scopes)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (tenant_id) DO UPDATE SET
      tenant_name = EXCLUDED.tenant_name,
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      expires_at = EXCLUDED.expires_at,
      scopes = EXCLUDED.scopes,
      updated_at = now()
  `, [
    tenant.tenantId,
    tenant.tenantName,
    JSON.stringify(accessEnc),
    JSON.stringify(refreshEnc),
    expiresAt,
    SCOPES,
  ]);

  return { tenantId: tenant.tenantId, tenantName: tenant.tenantName };
}

async function getConnection() {
  const { rows } = await db.query('SELECT * FROM acct_xero_connection LIMIT 1');
  return rows[0] || null;
}

async function getAccessToken() {
  const conn = await getConnection();
  if (!conn) throw new Error('Xero not connected');

  if (new Date(conn.expires_at) <= new Date(Date.now() + 60_000)) {
    return refreshTokens(conn);
  }

  return {
    accessToken: decrypt(JSON.parse(conn.access_token)),
    tenantId: conn.tenant_id,
  };
}

async function refreshTokens(conn) {
  if (!conn) conn = await getConnection();
  if (!conn) throw new Error('Xero not connected');

  const { XERO_CLIENT_ID, XERO_CLIENT_SECRET } = await getXeroCredentials();
  const basic = Buffer.from(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`).toString('base64');
  const refreshToken = decrypt(JSON.parse(conn.refresh_token));

  const res = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Xero token refresh failed: ${res.status} ${body}`);
  }

  const tokenData = await res.json();
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  const accessEnc = encrypt(tokenData.access_token);
  const refreshEnc = encrypt(tokenData.refresh_token);

  await db.query(`
    UPDATE acct_xero_connection
    SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = now()
    WHERE tenant_id = $4
  `, [
    JSON.stringify(accessEnc),
    JSON.stringify(refreshEnc),
    expiresAt,
    conn.tenant_id,
  ]);

  return {
    accessToken: tokenData.access_token,
    tenantId: conn.tenant_id,
  };
}

async function disconnect() {
  await db.query('DELETE FROM acct_xero_connection');
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  storeTokens,
  getConnection,
  getAccessToken,
  refreshTokens,
  disconnect,
  SCOPES,
};
