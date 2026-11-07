// Xero connector — October's own books.
//
// Unlike the client-facing connectors (Stripe, Shopify, etc.) this one serves
// the Accounts module, not a client record. It connects to a single Xero
// organisation via OAuth2, pulls unreconciled bank statement lines, and
// optionally writes coded transactions back.
//
// Token lifecycle: Xero rotates the refresh token on every refresh. The newest
// token is always stored; using a stale one kills the session permanently.

const axios = require('axios');
const db = require('../db');
const { encrypt, decrypt } = require('../utils/encryption');

const API = 'https://api.xero.com/api.xro/2.0';
const TOKEN_URL = 'https://identity.xero.com/connect/token';
const CONNECTIONS_URL = 'https://api.xero.com/connections';
const AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize';

const SCOPES = [
  'offline_access',
  'accounting.settings.read',
  'accounting.contacts.read',
  'accounting.reports.trialbalance.read',
  'accounting.reports.profitandloss.read',
  'accounting.reports.balancesheet.read',
  'accounting.banktransactions',
  'accounting.attachments',
].join(' ');

// Token refresh buffer: refresh 5 minutes before expiry.
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

async function getConnection() {
  const { rows } = await db.query('SELECT * FROM xero_connections LIMIT 1');
  if (!rows.length) return null;
  return rows[0];
}

async function getValidToken() {
  const conn = await getConnection();
  if (!conn) throw new Error('No Xero connection. Visit Settings > Accounts > Xero to connect.');

  const now = new Date();
  const expiresAt = new Date(conn.expires_at);

  if (now.getTime() < expiresAt.getTime() - REFRESH_BUFFER_MS) {
    return { accessToken: decrypt(conn.access_token), tenantId: conn.tenant_id };
  }

  return refreshToken(conn);
}

async function refreshToken(conn) {
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('XERO_CLIENT_ID and XERO_CLIENT_SECRET must be set');
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const currentRefresh = decrypt(conn.refresh_token);

  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: currentRefresh,
    }).toString(),
    {
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  const { access_token, refresh_token, expires_in } = res.data;

  await db.query(
    `UPDATE xero_connections
     SET access_token = $1, refresh_token = $2,
         expires_at = now() + ($3 || ' seconds')::interval,
         updated_at = now()
     WHERE tenant_id = $4`,
    [
      JSON.stringify(encrypt(access_token)),
      JSON.stringify(encrypt(refresh_token)),
      String(expires_in),
      conn.tenant_id,
    ]
  );

  return { accessToken: access_token, tenantId: conn.tenant_id };
}

function headers(accessToken, tenantId) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'xero-tenant-id': tenantId,
    Accept: 'application/json',
  };
}

// Rate-limit aware request. Xero allows 60 calls/minute on most endpoints.
// On 429, wait and retry once.
async function xeroGet(path, token, params = {}) {
  const { accessToken, tenantId } = token;
  try {
    const res = await axios.get(`${API}${path}`, {
      headers: headers(accessToken, tenantId),
      params,
    });
    return res.data;
  } catch (err) {
    if (err.response && err.response.status === 429) {
      const retryAfter = parseInt(err.response.headers['retry-after'] || '5', 10);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      const res = await axios.get(`${API}${path}`, {
        headers: headers(accessToken, tenantId),
        params,
      });
      return res.data;
    }
    throw err;
  }
}

async function xeroPost(path, token, body) {
  const { accessToken, tenantId } = token;
  const res = await axios.post(`${API}${path}`, body, {
    headers: { ...headers(accessToken, tenantId), 'Content-Type': 'application/json' },
  });
  return res.data;
}

async function xeroPut(path, token, body, contentType = 'application/json') {
  const { accessToken, tenantId } = token;
  const hdrs = { ...headers(accessToken, tenantId), 'Content-Type': contentType };
  const res = await axios.put(`${API}${path}`, body, { headers: hdrs });
  return res.data;
}

// --- Public API ---

async function getBankAccounts(token) {
  const data = await xeroGet('/Accounts', token, {
    where: 'Type=="BANK"',
  });
  return (data.Accounts || []).map(a => ({
    accountId: a.AccountID,
    name: a.Name,
    code: a.Code,
    currency: a.CurrencyCode,
    type: a.BankAccountType,
  }));
}

async function getBankStatementLines(token, bankAccountId, opts = {}) {
  const params = {};
  if (opts.since) params.where = `Date >= DateTime(${formatXeroDate(opts.since)})`;
  if (opts.page) params.page = opts.page;

  const data = await xeroGet(
    `/BankTransactions`,
    token,
    {
      ...params,
      where: [
        'IsReconciled==false',
        `BankAccount.AccountID=guid("${bankAccountId}")`,
        opts.since ? `Date >= DateTime(${formatXeroDate(opts.since)})` : null,
      ].filter(Boolean).join(' AND '),
      page: opts.page || 1,
      order: 'Date DESC',
    }
  );

  return (data.BankTransactions || []).map(tx => ({
    lineRef: tx.BankTransactionID,
    date: tx.Date,
    amount: tx.Total,
    currency: tx.CurrencyCode,
    description: tx.Contact ? tx.Contact.Name : (tx.Reference || ''),
    payee: tx.Contact ? tx.Contact.Name : '',
    reference: tx.Reference || '',
    bankAccountId: bankAccountId,
    type: tx.Type,
    lineItems: tx.LineItems || [],
    raw: tx,
  }));
}

async function getChartOfAccounts(token) {
  const data = await xeroGet('/Accounts', token);
  return (data.Accounts || []).map(a => ({
    code: a.Code,
    name: a.Name,
    type: a.Type,
    taxType: a.TaxType,
    status: a.Status,
    class: a.Class,
  }));
}

async function getTaxRates(token) {
  const data = await xeroGet('/TaxRates', token);
  return (data.TaxRates || []).map(r => ({
    name: r.Name,
    taxType: r.TaxType,
    effectiveRate: r.EffectiveRate,
    status: r.Status,
  }));
}

async function getContacts(token, opts = {}) {
  const params = {};
  if (opts.page) params.page = opts.page;
  if (opts.modifiedSince) params['If-Modified-Since'] = opts.modifiedSince;
  const data = await xeroGet('/Contacts', token, params);
  return (data.Contacts || []).map(c => ({
    contactId: c.ContactID,
    name: c.Name,
    isSupplier: c.IsSupplier,
    isCustomer: c.IsCustomer,
  }));
}

// Write a coded transaction back to Xero (reconciliation write-back).
// This creates the line items on an existing bank transaction so it can
// be reconciled with one click in Xero.
async function createBankTransactionLineItems(token, bankTransactionId, lineItems) {
  const body = {
    BankTransactions: [{
      BankTransactionID: bankTransactionId,
      LineItems: lineItems.map(li => ({
        AccountCode: li.accountCode,
        TaxType: li.taxRate || 'NONE',
        Description: li.description || '',
        LineAmount: li.amount,
      })),
    }],
  };
  return xeroPost('/BankTransactions', token, body);
}

// Attach a file (e.g. an invoice PDF) to a Xero bank transaction.
async function attachFile(token, entityType, entityId, filename, buffer, contentType) {
  const path = `/${entityType}/${entityId}/Attachments/${encodeURIComponent(filename)}`;
  return xeroPut(path, token, buffer, contentType || 'application/octet-stream');
}

// Get the trial balance report for year-end pack.
async function getTrialBalance(token, date) {
  const params = {};
  if (date) params.date = date;
  return xeroGet('/Reports/TrialBalance', token, params);
}

// Get the P&L report.
async function getProfitAndLoss(token, fromDate, toDate) {
  return xeroGet('/Reports/ProfitAndLoss', token, {
    fromDate,
    toDate,
  });
}

// Get the balance sheet.
async function getBalanceSheet(token, date) {
  const params = {};
  if (date) params.date = date;
  return xeroGet('/Reports/BalanceSheet', token, params);
}

// Connection status for the UI.
async function getConnectionStatus() {
  const conn = await getConnection();
  if (!conn) return { connected: false };
  return {
    connected: true,
    tenantName: conn.tenant_name,
    expiresAt: conn.expires_at,
    updatedAt: conn.updated_at,
  };
}

function formatXeroDate(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()},${dt.getMonth() + 1},${dt.getDate()}`;
}

module.exports = {
  SCOPES,
  AUTHORIZE_URL,
  TOKEN_URL,
  CONNECTIONS_URL,
  getConnection,
  getValidToken,
  getBankAccounts,
  getBankStatementLines,
  getChartOfAccounts,
  getTaxRates,
  getContacts,
  createBankTransactionLineItems,
  attachFile,
  getTrialBalance,
  getProfitAndLoss,
  getBalanceSheet,
  getConnectionStatus,
};
