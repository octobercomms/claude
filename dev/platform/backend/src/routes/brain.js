// Supplier brain API for the Xero reconciliation Chrome extension.
// Accepts extension bearer tokens OR admin JWT sessions (cookie/header).

const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../db');
const extensionAuth = require('../middleware/extensionAuth');
const accounts = require('../services/accounts');

// CORS for extension requests. MV3 content scripts send the page origin
// (go.xero.com), not chrome-extension://, so both must be allowed. Token
// auth on every route means allowing these origins is safe.
router.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (origin.startsWith('chrome-extension://') || origin === 'https://go.xero.com') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

async function brainAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const bearer = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.slice(7) : null;

  if (bearer) {
    try {
      const hash = extensionAuth.hashToken(bearer);
      const { rows } = await db.query(
        `SELECT id, label, created_at FROM acct_extension_tokens
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [hash]
      );
      if (rows.length) {
        db.query('UPDATE acct_extension_tokens SET last_used = now() WHERE id = $1', [rows[0].id]).catch(() => {});
        req.extensionToken = rows[0];
        return next();
      }
    } catch { /* fall through to JWT */ }
  }

  const cookie = req.headers.cookie;
  let jwtToken = bearer;
  if (!jwtToken && cookie) {
    for (const part of cookie.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === 'token') {
        jwtToken = decodeURIComponent(part.slice(eq + 1).trim());
        break;
      }
    }
  }

  if (jwtToken) {
    try {
      const payload = jwt.verify(jwtToken, process.env.JWT_SECRET);
      const where = payload.id ? 'id = $1' : 'username = $1';
      const value = payload.id || payload.username;
      const { rows } = await db.query(
        `SELECT id, username, role FROM users WHERE ${where}`, [value]
      );
      if (rows.length && rows[0].role === 'admin') {
        req.user = rows[0];
        return next();
      }
    } catch { /* fall through to 401 */ }
  }

  return res.status(401).json({ error: 'Extension token or admin session required' });
}

router.get('/lookup', brainAuth, async (req, res) => {
  try {
    const payee = req.query.payee;
    const lineText = req.query.lineText || null;
    if (!payee) return res.status(400).json({ error: 'payee query parameter required' });
    const result = await accounts.suppliers.fuzzyLookup(payee, lineText);
    if (!result) return res.json({ found: false });
    const supplier = result.supplier;
    res.json({
      found: true,
      matchScore: result.matchScore,
      matchType: result.matchType,
      supplier: {
        id: supplier.id,
        displayName: supplier.display_name,
        type: supplier.type || 'expense',
        accountCode: supplier.account_code,
        accountName: supplier.account_name,
        vatTreatment: supplier.vat_treatment,
        isReverseCharge: supplier.is_reverse_charge,
        confidenceCounter: supplier.confidence_counter,
        autoCode: supplier.auto_code,
        destinationBankAccountId: supplier.destination_bank_account_id || null,
        destinationBankAccountName: supplier.destination_bank_account_name || null,
        codingId: supplier.coding_id || null,
        codingTrigger: supplier.coding_trigger || null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/correct', brainAuth, async (req, res) => {
  try {
    const { supplierId, codingId, type, accountCode, accountName,
            vatTreatment, destinationBankAccountId, destinationBankAccountName,
            createCoding, triggerPatterns, notes } = req.body;
    if (!supplierId) return res.status(400).json({ error: 'supplierId required' });
    const supplier = await accounts.suppliers.correctSupplier(supplierId, {
      codingId, type, accountCode, accountName, vatTreatment,
      destinationBankAccountId, destinationBankAccountName,
      createCoding, triggerPatterns, notes,
    });
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json(supplier);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/bank-accounts', brainAuth, async (req, res) => {
  try {
    const accounts_ = await accounts.suppliers.getBankAccountsList();
    res.json({ accounts: accounts_ });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
