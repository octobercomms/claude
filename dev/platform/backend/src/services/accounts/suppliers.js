const db = require('../../db');
const xero = require('../../connectors/xero');

// ---------------------------------------------------------------------------
// Pattern matching — find a supplier from a bank line description
// ---------------------------------------------------------------------------

async function findSupplier(payee, currency) {
  if (!payee) return null;
  const normalised = payee.trim().toLowerCase();

  const { rows } = await db.query(
    `SELECT * FROM acct_suppliers
     WHERE EXISTS (
       SELECT 1 FROM unnest(match_patterns) AS p
       WHERE $1 LIKE '%' || replace(replace(replace(lower(p), '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%' ESCAPE '\\'
     )
     ORDER BY confidence_counter DESC
     LIMIT 1`,
    [normalised]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Three-tier classification
// ---------------------------------------------------------------------------
// Returns { tier: 1|2|3, supplier, flags[] }
//   tier 1 = auto-code silently
//   tier 2 = code it but surface in Friday email
//   tier 3 = unknown, ask Daniel

function assessTier(supplier, amount, currency) {
  if (!supplier) return { tier: 3, supplier: null, flags: ['No supplier match'] };

  const flags = [];
  const amt = Math.abs(parseFloat(amount) || 0);

  if (supplier.amount_min != null && supplier.amount_max != null) {
    const margin = Math.max((supplier.amount_max - supplier.amount_min) * 0.5, 10);
    if (amt < supplier.amount_min - margin || amt > supplier.amount_max + margin) {
      flags.push(`Amount ${amt.toFixed(2)} outside usual range ${Number(supplier.amount_min).toFixed(2)}–${Number(supplier.amount_max).toFixed(2)}`);
    }
  }

  if (supplier.usual_currency && currency &&
      currency.toUpperCase() !== supplier.usual_currency.toUpperCase()) {
    flags.push(`Currency ${currency} differs from usual ${supplier.usual_currency}`);
  }

  if (supplier.expected_cadence && supplier.expected_cadence !== 'ad_hoc' && supplier.last_seen) {
    const daysSinceLast = (Date.now() - new Date(supplier.last_seen).getTime()) / (1000 * 60 * 60 * 24);
    const expectedDays = { weekly: 10, monthly: 45, quarterly: 120, annual: 400 }[supplier.expected_cadence];
    if (expectedDays && daysSinceLast > expectedDays) {
      flags.push(`Gap of ${Math.round(daysSinceLast)}d since last seen; expected ${supplier.expected_cadence}`);
    }
  }

  if (!supplier.auto_code) {
    flags.push('Auto-coding disabled for this supplier');
    return { tier: 2, supplier, flags };
  }

  if (flags.length > 0) return { tier: 2, supplier, flags };
  return { tier: 1, supplier, flags: [] };
}

// ---------------------------------------------------------------------------
// Confirmation — bump confidence, update amount range + last_seen
// ---------------------------------------------------------------------------

async function confirmTransaction(supplierId, amount) {
  const amt = Math.abs(parseFloat(amount) || 0);

  await db.query(
    `UPDATE acct_suppliers SET
       confidence_counter = confidence_counter + 1,
       last_seen = now(),
       last_amount = $2,
       amount_min = CASE WHEN amount_min IS NULL OR $2 < amount_min THEN $2 ELSE amount_min END,
       amount_max = CASE WHEN amount_max IS NULL OR $2 > amount_max THEN $2 ELSE amount_max END,
       updated_at = now()
     WHERE id = $1`,
    [supplierId, amt]
  );
}

// ---------------------------------------------------------------------------
// Correction — overwrite brain record + reset confidence counter
// This is the most important behaviour: corrections must flow back.
// ---------------------------------------------------------------------------

async function correctSupplier(supplierId, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (data.accountCode !== undefined) {
    fields.push(`account_code = $${idx}`);
    values.push(data.accountCode);
    idx++;
  }
  if (data.accountName !== undefined) {
    fields.push(`account_name = $${idx}`);
    values.push(data.accountName);
    idx++;
  }
  if (data.vatTreatment !== undefined) {
    fields.push(`vat_treatment = $${idx}`);
    values.push(data.vatTreatment);
    idx++;
    fields.push(`is_reverse_charge = $${idx}`);
    values.push(data.vatTreatment === 'RRINPUT');
    idx++;
  }

  fields.push(`confidence_counter = 1`);
  fields.push(`updated_at = now()`);

  values.push(supplierId);
  const { rows } = await db.query(
    `UPDATE acct_suppliers SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

async function list(opts = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (opts.search) {
    const s = opts.search.toLowerCase().replace(/[%_\\]/g, '\\$&');
    conditions.push(`(lower(display_name) LIKE $${idx} ESCAPE '\\' OR lower(account_code) LIKE $${idx} ESCAPE '\\' OR EXISTS (SELECT 1 FROM unnest(match_patterns) AS p WHERE lower(p) LIKE $${idx} ESCAPE '\\'))`);
    params.push(`%${s}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const order = opts.sort === 'confidence' ? 'confidence_counter DESC' :
                opts.sort === 'name' ? 'display_name ASC' :
                opts.sort === 'last_seen' ? 'last_seen DESC NULLS LAST' :
                'confidence_counter DESC';

  params.push(opts.limit || 200);
  const limIdx = idx++;
  params.push(opts.offset || 0);
  const offIdx = idx++;

  const { rows } = await db.query(
    `SELECT * FROM acct_suppliers ${where} ORDER BY ${order} LIMIT $${limIdx} OFFSET $${offIdx}`,
    params
  );

  const { rows: countRows } = await db.query(
    `SELECT count(*)::int AS total FROM acct_suppliers ${where}`,
    params.slice(0, -2)
  );

  return { suppliers: rows, total: countRows[0]?.total || 0 };
}

async function getById(id) {
  const { rows } = await db.query('SELECT * FROM acct_suppliers WHERE id = $1', [id]);
  return rows[0] || null;
}

async function create(data) {
  const { rows } = await db.query(
    `INSERT INTO acct_suppliers
       (display_name, xero_contact_id, match_patterns, account_code, account_name,
        vat_treatment, is_reverse_charge, usual_currency, expected_cadence,
        invoice_source, confidence_counter, auto_code, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      data.displayName || data.display_name,
      data.xeroContactId || data.xero_contact_id || null,
      data.matchPatterns || data.match_patterns || [],
      data.accountCode || data.account_code,
      data.accountName || data.account_name || null,
      data.vatTreatment || data.vat_treatment || 'NONE',
      (data.vatTreatment || data.vat_treatment) === 'RRINPUT',
      data.usualCurrency || data.usual_currency || 'GBP',
      data.expectedCadence || data.expected_cadence || null,
      data.invoiceSource || data.invoice_source || 'unknown',
      data.confidenceCounter || data.confidence_counter || 0,
      data.autoCode !== undefined ? data.autoCode : (data.auto_code !== undefined ? data.auto_code : true),
      data.notes || null,
    ]
  );
  return rows[0];
}

async function update(id, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  const mappings = [
    [['displayName', 'display_name'], 'display_name'],
    [['xeroContactId', 'xero_contact_id'], 'xero_contact_id'],
    [['matchPatterns', 'match_patterns'], 'match_patterns'],
    [['accountCode', 'account_code'], 'account_code'],
    [['accountName', 'account_name'], 'account_name'],
    [['vatTreatment', 'vat_treatment'], 'vat_treatment'],
    [['usualCurrency', 'usual_currency'], 'usual_currency'],
    [['expectedCadence', 'expected_cadence'], 'expected_cadence'],
    [['invoiceSource', 'invoice_source'], 'invoice_source'],
    [['autoCode', 'auto_code'], 'auto_code'],
    [['notes'], 'notes'],
  ];

  for (const [keys, col] of mappings) {
    const key = keys.find(k => data[k] !== undefined);
    if (key) {
      fields.push(`${col} = $${idx}`);
      values.push(data[key]);
      idx++;
    }
  }

  if (data.vatTreatment !== undefined || data.vat_treatment !== undefined) {
    const vat = data.vatTreatment || data.vat_treatment;
    fields.push(`is_reverse_charge = $${idx}`);
    values.push(vat === 'RRINPUT');
    idx++;
  }

  if (!fields.length) return null;
  fields.push('updated_at = now()');
  values.push(id);

  const { rows } = await db.query(
    `UPDATE acct_suppliers SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return rows[0] || null;
}

async function remove(id) {
  const { rowCount } = await db.query('DELETE FROM acct_suppliers WHERE id = $1', [id]);
  return rowCount > 0;
}

// ---------------------------------------------------------------------------
// Bootstrap — seed from Xero transaction history
// ---------------------------------------------------------------------------
// Reads coded BankTransactions from Xero, groups by contact, and proposes
// supplier records with the most common account code + VAT treatment per
// contact. This is the right endpoint because /BankTransactions returns
// coded ledger entries, which is exactly the history we want.

async function bootstrapFromXero() {
  const t0 = Date.now();
  console.log('[Suppliers] Bootstrap started');

  const token = await xero.getValidToken();

  // getAllBankTransactions returns ALL transactions (reconciled included)
  // with full line-item coding data. Reconciled transactions are the ones
  // Daniel already coded, so their account codes and tax rates are ground
  // truth for seeding the brain.
  console.log('[Suppliers] Fetching all bank transactions...');
  const txns = await xero.getAllBankTransactions(token);
  console.log('[Suppliers] Got %d transactions (%dms)', txns.length, Date.now() - t0);

  // Also pull Contacts for proper display names.
  const xeroContacts = new Map();
  let contactPage = 1;
  let contactHasMore = true;
  while (contactHasMore) {
    const contacts = await xero.getContacts(token, { page: contactPage });
    if (!contacts.length) { contactHasMore = false; break; }
    for (const c of contacts) {
      xeroContacts.set(c.contactId, c.name);
    }
    if (contacts.length < 100) contactHasMore = false;
    else contactPage++;
  }

  // Look up account names from chart of accounts.
  const chartLookup = {};
  try {
    const chart = await xero.getChartOfAccounts(token);
    for (const a of chart) chartLookup[a.code] = a.name;
  } catch (e) {
    console.warn('[Suppliers] Could not fetch chart of accounts:', e.message);
  }

  const contactMap = new Map();

  for (const tx of txns) {
    if (!tx.contactId || !tx.contactName) continue;

    const key = tx.contactId;
    if (!contactMap.has(key)) {
      contactMap.set(key, {
        displayName: xeroContacts.get(tx.contactId) || tx.contactName.trim(),
        xeroContactId: tx.contactId,
        patterns: new Set(),
        codings: [],
        amounts: [],
        currencies: new Set(),
        dates: [],
      });
    }

    const entry = contactMap.get(key);
    entry.patterns.add(tx.contactName.trim().toLowerCase());
    if (tx.reference) {
      const ref = tx.reference.trim().toLowerCase();
      if (ref.length >= 3) entry.patterns.add(ref);
    }

    for (const li of tx.lineItems) {
      if (li.accountCode) {
        entry.codings.push({
          code: li.accountCode,
          name: chartLookup[li.accountCode] || null,
          rate: li.taxType || null,
        });
      }
    }

    entry.amounts.push(Math.abs(parseFloat(tx.amount) || 0));
    if (tx.currency) entry.currencies.add(tx.currency.toUpperCase());
    if (tx.date) entry.dates.push(new Date(tx.date));
  }

  console.log('[Suppliers] %d unique contacts found (%dms)', contactMap.size, Date.now() - t0);

  let created = 0;
  let skipped = 0;

  for (const [, entry] of contactMap) {
    if (!entry.codings.length) { skipped++; continue; }

    const patterns = [...entry.patterns].filter(p => p.length >= 3);
    if (!patterns.length) { skipped++; continue; }

    // Skip if supplier already exists for this Xero contact.
    const { rows: existingContact } = await db.query(
      'SELECT id FROM acct_suppliers WHERE xero_contact_id = $1',
      [entry.xeroContactId]
    );
    if (existingContact.length) { skipped++; continue; }

    const existing = await findSupplierByPatterns(patterns);
    if (existing) { skipped++; continue; }

    const codeCounts = {};
    for (const c of entry.codings) {
      const k = `${c.code}||${c.rate || 'NONE'}`;
      codeCounts[k] = (codeCounts[k] || 0) + 1;
    }
    const topCoding = Object.entries(codeCounts).sort((a, b) => b[1] - a[1])[0];
    const [code, rate] = topCoding[0].split('||');
    const consistency = topCoding[1] / entry.codings.length;

    const codeName = entry.codings.find(c => c.code === code)?.name || null;

    const amounts = entry.amounts.filter(a => a > 0);
    const amountMin = amounts.length ? Math.min(...amounts) : null;
    const amountMax = amounts.length ? Math.max(...amounts) : null;

    const currencies = [...entry.currencies];
    const usualCurrency = currencies.length === 1 ? currencies[0] : 'GBP';

    let cadence = 'ad_hoc';
    if (entry.dates.length >= 3) {
      const sorted = entry.dates.sort((a, b) => a - b);
      const gaps = [];
      for (let i = 1; i < sorted.length; i++) {
        gaps.push((sorted[i] - sorted[i - 1]) / (1000 * 60 * 60 * 24));
      }
      const median = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
      if (median <= 10) cadence = 'weekly';
      else if (median <= 45) cadence = 'monthly';
      else if (median <= 120) cadence = 'quarterly';
      else if (median <= 400) cadence = 'annual';
    }

    await db.query(
      `INSERT INTO acct_suppliers
         (display_name, xero_contact_id, match_patterns, account_code, account_name,
          vat_treatment, is_reverse_charge, usual_currency, expected_cadence,
          confidence_counter, last_amount, amount_min, amount_max,
          last_seen, auto_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT DO NOTHING`,
      [
        entry.displayName,
        entry.xeroContactId,
        patterns,
        code,
        codeName,
        rate || 'NONE',
        rate === 'RRINPUT',
        usualCurrency,
        cadence,
        Math.round(consistency * entry.codings.length),
        amounts.length ? amounts[amounts.length - 1] : null,
        amountMin,
        amountMax,
        entry.dates.length ? entry.dates.sort((a, b) => b - a)[0] : null,
        consistency >= 0.8,
      ]
    );
    created++;
  }

  console.log('[Suppliers] Bootstrap complete: %d created, %d skipped (%dms)',
    created, skipped, Date.now() - t0);
  return { created, skipped, contactsFound: contactMap.size };
}

async function findSupplierByPatterns(patterns) {
  for (const p of patterns) {
    const supplier = await findSupplier(p);
    if (supplier) return supplier;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Stats for the dashboard
// ---------------------------------------------------------------------------

async function getStats() {
  const { rows } = await db.query(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE confidence_counter >= 10)::int AS settled,
      count(*) FILTER (WHERE confidence_counter < 3)::int AS learning,
      count(*) FILTER (WHERE auto_code = true)::int AS auto_coding,
      count(*) FILTER (WHERE is_reverse_charge = true)::int AS reverse_charge
    FROM acct_suppliers
  `);
  return rows[0] || { total: 0, settled: 0, learning: 0, auto_coding: 0, reverse_charge: 0 };
}

// Auto-coded transactions for Friday email drift protection
async function getAutoCodedSummary(since) {
  const sinceDate = since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const { rows } = await db.query(
    `SELECT s.display_name, count(*)::int AS count
     FROM acct_confirmations c
     JOIN acct_reconcile_queue q ON q.id = c.queue_item_id
     JOIN acct_suppliers s ON s.id = (
       SELECT id FROM acct_suppliers
       WHERE EXISTS (
         SELECT 1 FROM unnest(match_patterns) AS p
         WHERE lower(q.payee) LIKE '%' || lower(p) || '%'
       )
       LIMIT 1
     )
     WHERE c.source = 'rule'
       AND c.confirmed_at >= $1
     GROUP BY s.display_name
     ORDER BY count DESC`,
    [sinceDate]
  );
  return rows;
}

module.exports = {
  findSupplier,
  assessTier,
  confirmTransaction,
  correctSupplier,
  list,
  getById,
  create,
  update,
  remove,
  bootstrapFromXero,
  getStats,
  getAutoCodedSummary,
};
