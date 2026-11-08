// Supplier brain API for the Xero reconciliation Chrome extension.
// Uses extension token auth (bearer token), NOT JWT session auth.
// Mounted separately from /api/accounts to bypass the JWT middleware.

const express = require('express');
const router = express.Router();
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

router.get('/lookup', extensionAuth.authenticateExtension, async (req, res) => {
  try {
    const payee = req.query.payee;
    if (!payee) return res.status(400).json({ error: 'payee query parameter required' });
    const result = await accounts.suppliers.fuzzyLookup(payee);
    if (!result) return res.json({ found: false });
    const supplier = result.supplier;
    res.json({
      found: true,
      matchScore: result.matchScore,
      matchType: result.matchType,
      supplier: {
        id: supplier.id,
        displayName: supplier.display_name,
        accountCode: supplier.account_code,
        accountName: supplier.account_name,
        vatTreatment: supplier.vat_treatment,
        isReverseCharge: supplier.is_reverse_charge,
        confidenceCounter: supplier.confidence_counter,
        autoCode: supplier.auto_code,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/correct', extensionAuth.authenticateExtension, async (req, res) => {
  try {
    const { supplierId, accountCode, vatTreatment, notes } = req.body;
    if (!supplierId) return res.status(400).json({ error: 'supplierId required' });
    const supplier = await accounts.suppliers.correctSupplier(supplierId, {
      accountCode, vatTreatment, notes,
    });
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json(supplier);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
