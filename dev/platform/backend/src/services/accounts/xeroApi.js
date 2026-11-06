const xeroAuth = require('./xeroAuth');

const BASE = 'https://api.xero.com/api.xro/2.0';

async function xeroFetch(path, opts = {}) {
  const { accessToken, tenantId } = await xeroAuth.getAccessToken();
  const url = `${BASE}${path}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      ...opts,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Xero-Tenant-Id': tenantId,
        'Accept': 'application/json',
        ...opts.headers,
      },
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
      await new Promise(r => setTimeout(r, retryAfter * 1000 * (attempt + 1)));
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Xero API ${res.status}: ${body}`);
    }

    return res.json();
  }
  throw new Error('Xero API: rate limit exceeded after retries');
}

async function fetchBankTransactions({ since, page = 1 } = {}) {
  let path = `/BankTransactions?page=${page}&order=Date DESC`;
  if (since) {
    const header = `Date >= DateTime(${since.getFullYear()},${since.getMonth() + 1},${since.getDate()})`;
    path += `&where=${encodeURIComponent(header)}`;
  }
  const data = await xeroFetch(path);
  return (data.BankTransactions || []).filter(t => !t.IsReconciled);
}

async function fetchAllUnreconciled(since) {
  const all = [];
  let page = 1;
  while (true) {
    const batch = await fetchBankTransactions({ since, page });
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

async function fetchContacts() {
  const data = await xeroFetch('/Contacts?page=1&order=Name');
  return data.Contacts || [];
}

async function fetchAccounts() {
  const data = await xeroFetch('/Accounts');
  return data.Accounts || [];
}

async function fetchTaxRates() {
  const data = await xeroFetch('/TaxRates');
  return data.TaxRates || [];
}

async function fetchOrganisation() {
  const data = await xeroFetch('/Organisation');
  return data.Organisations ? data.Organisations[0] : null;
}

async function createBankTransaction(transaction) {
  return xeroFetch('/BankTransactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ BankTransactions: [transaction] }),
  });
}

async function attachFileToTransaction(transactionId, filename, buffer, contentType) {
  const { accessToken, tenantId } = await xeroAuth.getAccessToken();
  const url = `${BASE}/BankTransactions/${transactionId}/Attachments/${encodeURIComponent(filename)}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
    },
    body: buffer,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Xero attachment upload failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function fetchReportProfitAndLoss(fromDate, toDate) {
  const params = new URLSearchParams({ fromDate, toDate });
  return xeroFetch(`/Reports/ProfitAndLoss?${params}`);
}

async function fetchReportBalanceSheet(date) {
  return xeroFetch(`/Reports/BalanceSheet?date=${date}`);
}

async function fetchReportTrialBalance(date) {
  return xeroFetch(`/Reports/TrialBalance?date=${date}`);
}

module.exports = {
  fetchBankTransactions,
  fetchAllUnreconciled,
  fetchContacts,
  fetchAccounts,
  fetchTaxRates,
  fetchOrganisation,
  createBankTransaction,
  attachFileToTransaction,
  fetchReportProfitAndLoss,
  fetchReportBalanceSheet,
  fetchReportTrialBalance,
};
