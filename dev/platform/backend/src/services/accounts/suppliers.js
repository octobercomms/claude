const db = require('../../db');
const xero = require('../../connectors/xero');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TX_PREFIX_RE = /^(card|transfer|direct[_-]debit|fee[_-]card)-\d+$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
const UUID_DATE_RE = /^[0-9a-f]{6,}-\d{6,}-\d+$/i;

function isTransactionReference(pattern) {
  const p = pattern.trim();
  if (TX_PREFIX_RE.test(p)) return true;
  if (UUID_RE.test(p)) return true;
  if (UUID_DATE_RE.test(p)) return true;
  if (p.length > 12 && !/[\s/]/.test(p) && /[a-z]/i.test(p) && /\d/.test(p)) return true;
  if (p.length > 15 && /^\d+$/.test(p)) return true;
  return false;
}

function filterPatterns(patterns) {
  return patterns.filter(p => p.length >= 2 && !isTransactionReference(p));
}

function isValidSupplierName(name) {
  if (!name || name.trim().length < 3) return false;
  if (/^[\d*?]+$/.test(name.trim())) return false;
  return true;
}

const REVERSE_CHARGE_CODES = new Set(['RRINPUT', 'RRINPUT2', 'REVERSECHARGES']);

function isReverseCharge(vatTreatment) {
  if (!vatTreatment) return false;
  return REVERSE_CHARGE_CODES.has(vatTreatment.toUpperCase());
}

const AUTO_CODE_CONFIDENCE_THRESHOLD = parseInt(process.env.ACCOUNTS_AUTO_CODE_THRESHOLD, 10) || 5;

function inferCadence(dates) {
  if (dates.length < 4) return 'ad_hoc';

  const sorted = [...dates].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const days = (sorted[i] - sorted[i - 1]) / (1000 * 60 * 60 * 24);
    if (days >= 5) gaps.push(days);
  }

  if (gaps.length < 3) return 'ad_hoc';

  const buckets = { weekly: 0, monthly: 0, quarterly: 0, annual: 0 };
  let other = 0;
  for (const g of gaps) {
    if (g >= 5 && g <= 10) buckets.weekly++;
    else if (g > 10 && g <= 50) buckets.monthly++;
    else if (g > 50 && g <= 150) buckets.quarterly++;
    else if (g > 150 && g <= 400) buckets.annual++;
    else other++;
  }

  const total = gaps.length;
  const entries = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
  const [bestCadence, bestCount] = entries[0];

  if (bestCount / total >= 0.5 && bestCount >= 3) return bestCadence;
  return 'ad_hoc';
}

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
    values.push(isReverseCharge(data.vatTreatment));
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

  if (opts.vatTreatment) {
    conditions.push(`vat_treatment = $${idx}`);
    params.push(opts.vatTreatment);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const order = opts.sort === 'confidence' ? 'confidence_counter DESC' :
                opts.sort === 'name' ? 'display_name ASC' :
                opts.sort === 'last_seen' ? 'last_seen DESC NULLS LAST' :
                opts.sort === 'vat' ? 'vat_treatment ASC, display_name ASC' :
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
      isReverseCharge(data.vatTreatment || data.vat_treatment),
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
    values.push(isReverseCharge(vat));
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
    if (tx.date) {
      const d = new Date(tx.date);
      if (!isNaN(d.getTime())) entry.dates.push(d);
    }
  }

  console.log('[Suppliers] %d unique contacts found (%dms)', contactMap.size, Date.now() - t0);

  let created = 0;
  let skipped = 0;

  for (const [, entry] of contactMap) {
    if (!isValidSupplierName(entry.displayName)) { skipped++; continue; }
    if (!entry.codings.length) { skipped++; continue; }

    const patterns = filterPatterns([...entry.patterns]);
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

    const cadence = inferCadence(entry.dates);
    const confidenceCount = topCoding[1];

    await db.query(
      `INSERT INTO acct_suppliers
         (display_name, xero_contact_id, match_patterns, account_code, account_name,
          vat_treatment, is_reverse_charge, usual_currency, expected_cadence,
          confidence_counter, last_amount, amount_min, amount_max,
          last_seen, auto_code, invoice_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT DO NOTHING`,
      [
        entry.displayName,
        entry.xeroContactId,
        patterns,
        code,
        codeName,
        rate || 'NONE',
        isReverseCharge(rate),
        usualCurrency,
        cadence,
        confidenceCount,
        amounts.length ? amounts[amounts.length - 1] : null,
        amountMin,
        amountMax,
        entry.dates.length ? entry.dates.sort((a, b) => b - a)[0] : null,
        confidenceCount >= AUTO_CODE_CONFIDENCE_THRESHOLD,
        'drive',
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

async function findSupplierByFolderName(folderName) {
  if (!folderName) return null;
  const normalised = folderName.trim().toLowerCase();

  const { rows } = await db.query(
    `SELECT * FROM acct_suppliers
     WHERE EXISTS (
       SELECT 1 FROM unnest(match_patterns) AS p
       WHERE lower(p) = $1
     )
     ORDER BY confidence_counter DESC
     LIMIT 1`,
    [normalised]
  );
  if (rows.length) return rows[0];

  const { rows: fuzzy } = await db.query(
    `SELECT * FROM acct_suppliers
     WHERE lower(display_name) = $1
     ORDER BY confidence_counter DESC
     LIMIT 1`,
    [normalised]
  );
  return fuzzy[0] || null;
}

async function seedFromDriveFolders(supplierMap) {
  let created = 0;
  let matched = 0;
  let skipped = 0;

  for (const [folderName, files] of Object.entries(supplierMap)) {
    const existing = await findSupplierByFolderName(folderName);
    if (existing) {
      const patterns = existing.match_patterns || [];
      const lower = folderName.trim().toLowerCase();
      if (!patterns.some(p => p.toLowerCase() === lower)) {
        await db.query(
          `UPDATE acct_suppliers
           SET match_patterns = array_append(match_patterns, $2), updated_at = NOW()
           WHERE id = $1`,
          [existing.id, folderName.trim()]
        );
      }
      matched++;
      continue;
    }

    const pattern = folderName.trim();
    if (pattern.length < 2) { skipped++; continue; }

    await db.query(
      `INSERT INTO acct_suppliers
         (display_name, match_patterns, invoice_source, confidence_counter, auto_code)
       VALUES ($1, $2, 'drive_folder', 0, false)
       ON CONFLICT DO NOTHING`,
      [pattern, [pattern.toLowerCase()]]
    );
    created++;
  }

  return { created, matched, skipped };
}

// ---------------------------------------------------------------------------
// Cleanup — fix existing records seeded before quality filters
// ---------------------------------------------------------------------------

async function cleanup() {
  const results = { patternsStripped: 0, reverseChargeFixed: 0, cadenceReset: 0, junkDeleted: 0, autoCodeFixed: 0, invoiceSourceFixed: 0 };

  const { rows: all } = await db.query('SELECT id, display_name, match_patterns, vat_treatment, is_reverse_charge, expected_cadence, confidence_counter, auto_code, invoice_source FROM acct_suppliers');

  for (const row of all) {
    if (!isValidSupplierName(row.display_name)) {
      await db.query('DELETE FROM acct_suppliers WHERE id = $1', [row.id]);
      results.junkDeleted++;
      continue;
    }

    const updates = [];
    const values = [];
    let idx = 1;

    const oldPatterns = row.match_patterns || [];
    const cleaned = filterPatterns(oldPatterns);
    if (cleaned.length !== oldPatterns.length) {
      if (cleaned.length === 0) {
        await db.query('DELETE FROM acct_suppliers WHERE id = $1', [row.id]);
        results.junkDeleted++;
        continue;
      }
      updates.push(`match_patterns = $${idx}`);
      values.push(cleaned);
      idx++;
      results.patternsStripped++;
    }

    const shouldBeRC = isReverseCharge(row.vat_treatment);
    if (row.is_reverse_charge !== shouldBeRC) {
      updates.push(`is_reverse_charge = $${idx}`);
      values.push(shouldBeRC);
      idx++;
      results.reverseChargeFixed++;
    }

    if (row.expected_cadence === 'weekly') {
      updates.push(`expected_cadence = $${idx}`);
      values.push('ad_hoc');
      idx++;
      results.cadenceReset++;
    }

    const shouldAutoCode = (row.confidence_counter || 0) >= AUTO_CODE_CONFIDENCE_THRESHOLD;
    if (row.auto_code !== shouldAutoCode) {
      updates.push(`auto_code = $${idx}`);
      values.push(shouldAutoCode);
      idx++;
      results.autoCodeFixed++;
    }

    if (!row.invoice_source || row.invoice_source === 'unknown') {
      updates.push(`invoice_source = $${idx}`);
      values.push('drive');
      idx++;
      results.invoiceSourceFixed++;
    }

    if (updates.length) {
      updates.push('updated_at = now()');
      values.push(row.id);
      await db.query(
        `UPDATE acct_suppliers SET ${updates.join(', ')} WHERE id = $${idx}`,
        values
      );
    }
  }

  return results;
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
      count(*) FILTER (WHERE confidence_counter >= $1)::int AS auto_coding,
      count(*) FILTER (WHERE upper(vat_treatment) IN ('RRINPUT', 'RRINPUT2', 'REVERSECHARGES'))::int AS reverse_charge
    FROM acct_suppliers
  `, [AUTO_CODE_CONFIDENCE_THRESHOLD]);
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

// ---------------------------------------------------------------------------
// Fuzzy lookup — for the Chrome extension and pre-coding.
// Xero's payee text varies: "ANTHROPIC PBC", "Anthropic", "HETZNER ONLINE
// GMBH" vs "Hetzner". This does trigram-style scoring in JS rather than
// requiring pg_trgm.
// ---------------------------------------------------------------------------

function normalise(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function scoreMatch(payeeNorm, supplier) {
  const patterns = (supplier.match_patterns || []).map(normalise);
  const displayNorm = normalise(supplier.display_name || '');
  const candidates = [...patterns, displayNorm].filter(Boolean);

  let best = 0;

  for (const candidate of candidates) {
    if (payeeNorm === candidate) return 1.0;
    if (payeeNorm.includes(candidate) || candidate.includes(payeeNorm)) {
      const overlap = Math.min(payeeNorm.length, candidate.length) /
                      Math.max(payeeNorm.length, candidate.length);
      best = Math.max(best, 0.7 + overlap * 0.3);
      continue;
    }
    const words = candidate.split(' ');
    const payeeWords = payeeNorm.split(' ');
    let wordHits = 0;
    for (const w of words) {
      if (w.length < 3) continue;
      if (payeeWords.some(pw => pw === w || pw.includes(w) || w.includes(pw))) wordHits++;
    }
    if (words.filter(w => w.length >= 3).length > 0) {
      const wordScore = wordHits / words.filter(w => w.length >= 3).length;
      best = Math.max(best, wordScore * 0.7);
    }
    const maxLen = Math.max(payeeNorm.length, candidate.length);
    if (maxLen <= 30) {
      const dist = levenshtein(payeeNorm, candidate);
      const levScore = 1 - dist / maxLen;
      if (levScore > 0.5) best = Math.max(best, levScore * 0.6);
    }
  }

  return best;
}

async function fuzzyLookup(payee) {
  if (!payee || !payee.trim()) return null;
  const payeeNorm = normalise(payee);
  if (!payeeNorm) return null;

  const exactMatch = await findSupplier(payee);
  if (exactMatch) {
    return {
      supplier: exactMatch,
      matchScore: 1.0,
      matchType: 'exact',
    };
  }

  const { rows } = await db.query('SELECT * FROM acct_suppliers ORDER BY confidence_counter DESC');

  let bestScore = 0;
  let bestSupplier = null;

  for (const row of rows) {
    const score = scoreMatch(payeeNorm, row);
    if (score > bestScore) {
      bestScore = score;
      bestSupplier = row;
    }
  }

  if (bestScore < 0.4 || !bestSupplier) return null;

  return {
    supplier: bestSupplier,
    matchScore: Math.round(bestScore * 100) / 100,
    matchType: bestScore >= 0.85 ? 'strong' : bestScore >= 0.6 ? 'likely' : 'weak',
  };
}

module.exports = {
  findSupplier,
  findSupplierByFolderName,
  fuzzyLookup,
  assessTier,
  confirmTransaction,
  correctSupplier,
  list,
  getById,
  create,
  update,
  remove,
  bootstrapFromXero,
  seedFromDriveFolders,
  cleanup,
  getStats,
  getAutoCodedSummary,
  AUTO_CODE_CONFIDENCE_THRESHOLD,
};
