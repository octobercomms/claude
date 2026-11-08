const db = require('../../db');
const xero = require('../../connectors/xero');
const suppliers = require('./suppliers');
const invoices = require('./invoices');

const AUTO_CODE_THRESHOLD = parseInt(process.env.AUTO_CODE_CONFIDENCE_THRESHOLD, 10) || 5;

async function getEligibleSuppliers() {
  const { rows } = await db.query(
    `SELECT * FROM acct_suppliers
     WHERE confidence_counter >= $1
       AND account_code IS NOT NULL
       AND vat_treatment IS NOT NULL
     ORDER BY display_name`,
    [AUTO_CODE_THRESHOLD]
  );
  return rows;
}

async function createSpendTransaction(token, params) {
  const {
    contactId,
    contactName,
    bankAccountId,
    accountCode,
    taxType,
    amount,
    currency,
    reference,
    date,
  } = params;

  const body = {
    BankTransactions: [{
      Type: 'SPEND',
      Contact: contactId ? { ContactID: contactId } : { Name: contactName },
      BankAccount: { AccountID: bankAccountId },
      Date: date || new Date().toISOString().split('T')[0],
      Reference: reference || `OMI pre-coded: ${contactName}`,
      CurrencyCode: currency || 'GBP',
      LineItems: [{
        Description: reference || `${contactName} payment`,
        AccountCode: accountCode,
        TaxType: taxType || 'INPUT2',
        LineAmount: Math.abs(amount),
      }],
    }],
  };

  const result = await xero.xeroPost('/BankTransactions', token, body);
  const tx = result?.BankTransactions?.[0];
  if (!tx) throw new Error('Xero returned no transaction');
  return {
    transactionId: tx.BankTransactionID,
    status: tx.Status,
    total: tx.Total,
    date: tx.Date,
  };
}

async function precodeSupplier(supplier, bankAccountId, opts = {}) {
  const token = await xero.getValidToken();
  const amount = opts.amount || supplier.last_amount;
  if (!amount) return { skipped: true, reason: 'no amount available' };

  let invoiceFile = null;
  if (!opts.skipInvoice) {
    const matched = await invoices.findLatestForSupplier(supplier.id);
    if (matched) invoiceFile = matched;
  }

  let xeroTx;
  try {
    xeroTx = await createSpendTransaction(token, {
      contactId: supplier.xero_contact_id,
      contactName: supplier.display_name,
      bankAccountId,
      accountCode: supplier.account_code,
      taxType: supplier.vat_treatment,
      amount,
      currency: supplier.usual_currency || 'GBP',
      reference: opts.reference || undefined,
      date: opts.date || undefined,
    });
  } catch (err) {
    await logPrecode({
      supplierId: supplier.id,
      supplierName: supplier.display_name,
      accountCode: supplier.account_code,
      vatTreatment: supplier.vat_treatment,
      amount,
      currency: supplier.usual_currency || 'GBP',
      status: 'error',
      errorMessage: err.message,
    });
    return { error: err.message };
  }

  if (invoiceFile && invoiceFile.file_path) {
    try {
      const fs = require('fs');
      const path = require('path');
      const buf = fs.readFileSync(invoiceFile.file_path);
      const filename = path.basename(invoiceFile.file_path);
      const contentType = filename.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';
      await xero.attachFile(token, 'BankTransactions', xeroTx.transactionId, filename, buf, contentType);
    } catch (attachErr) {
      console.warn('[precode] Invoice attachment failed:', attachErr.message);
    }
  }

  const log = await logPrecode({
    supplierId: supplier.id,
    supplierName: supplier.display_name,
    accountCode: supplier.account_code,
    vatTreatment: supplier.vat_treatment,
    amount,
    currency: supplier.usual_currency || 'GBP',
    xeroTransactionId: xeroTx.transactionId,
    invoiceMatchId: invoiceFile?.id || null,
    invoiceFilename: invoiceFile?.file_path || null,
    status: 'written',
  });

  return { transaction: xeroTx, log, invoiceAttached: !!invoiceFile };
}

async function logPrecode(data) {
  const { rows } = await db.query(
    `INSERT INTO acct_precode_log
       (supplier_id, supplier_name, account_code, vat_treatment, amount, currency,
        xero_transaction_id, invoice_match_id, invoice_filename, status, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      data.supplierId, data.supplierName, data.accountCode, data.vatTreatment,
      data.amount, data.currency || 'GBP',
      data.xeroTransactionId || null, data.invoiceMatchId || null,
      data.invoiceFilename || null, data.status || 'written',
      data.errorMessage || null,
    ]
  );
  return rows[0];
}

async function getRecentPrecodes(since) {
  const { rows } = await db.query(
    `SELECT * FROM acct_precode_log
     WHERE created_at >= $1
     ORDER BY created_at DESC`,
    [since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()]
  );
  return rows;
}

async function getPrecodeStats() {
  const { rows: logRows } = await db.query(
    `SELECT
       count(*)::int as total,
       count(*) FILTER (WHERE status = 'written')::int as written,
       count(*) FILTER (WHERE status = 'matched')::int as matched,
       count(*) FILTER (WHERE status = 'error')::int as errors,
       coalesce(sum(amount) FILTER (WHERE status = 'written'), 0) as total_amount,
       max(created_at) as last_run_at
     FROM acct_precode_log`
  );
  const stats = logRows[0];

  const eligible = await getEligibleSuppliers();
  const hasRun = stats.total > 0;

  return {
    ...stats,
    state: hasRun
      ? (stats.written > 0 ? 'has_writes' : 'ran_nothing_eligible')
      : 'not_run',
    eligible_now: eligible.length,
  };
}

async function previewPrecodePass() {
  const eligible = await getEligibleSuppliers();
  if (!eligible.length) {
    return { state: 'nothing_eligible', eligible: 0, preview: [] };
  }

  const preview = [];
  for (const supplier of eligible) {
    const amount = supplier.last_amount;
    let invoice = null;
    try {
      invoice = await invoices.findLatestForSupplier(supplier.id);
    } catch { /* no invoice is fine */ }

    preview.push({
      supplierId: supplier.id,
      supplierName: supplier.display_name,
      accountCode: supplier.account_code,
      accountName: supplier.account_name || null,
      vatTreatment: supplier.vat_treatment,
      isReverseCharge: ['RRINPUT', 'RRINPUT2', 'REVERSECHARGES'].includes(supplier.vat_treatment),
      amount: amount ? Math.abs(amount) : null,
      currency: supplier.usual_currency || 'GBP',
      confidenceCounter: parseInt(supplier.confidence_counter, 10) || 0,
      hasAmount: !!amount,
      wouldSkip: !amount,
      skipReason: !amount ? 'no amount available' : null,
      matchedInvoice: invoice ? {
        id: invoice.id,
        filename: invoice.file_path || invoice.original_filename || null,
      } : null,
    });
  }

  preview.sort((a, b) => a.confidenceCounter - b.confidenceCounter);

  const wouldWrite = preview.filter(p => !p.wouldSkip).length;
  const wouldSkip = preview.filter(p => p.wouldSkip).length;

  return {
    state: 'preview',
    eligible: eligible.length,
    wouldWrite,
    wouldSkip,
    preview,
  };
}

async function runPrecodePass(bankAccountId) {
  const eligible = await getEligibleSuppliers();
  if (!eligible.length) return { ran: 0, results: [] };

  const results = [];
  for (const supplier of eligible) {
    try {
      const result = await precodeSupplier(supplier, bankAccountId);
      results.push({ supplier: supplier.display_name, ...result });
    } catch (err) {
      results.push({ supplier: supplier.display_name, error: err.message });
    }
  }
  return { ran: results.length, results };
}

module.exports = {
  getEligibleSuppliers,
  createSpendTransaction,
  precodeSupplier,
  logPrecode,
  getRecentPrecodes,
  getPrecodeStats,
  previewPrecodePass,
  runPrecodePass,
};
