// The type scale, read and written.
//
// GET  /api/ui/type-scale          what can be changed, the company default,
//                                  this user's overrides, and the resolved
//                                  values the shell should apply
// PUT  /api/ui/type-scale/me       this user's overrides   (any role)
// PUT  /api/ui/type-scale/company  the company default     (admin only)
//
// Every authenticated role can read it, because the shell applies the scale on
// every page for every user including a client login. Writing the company
// default is admin-only; writing your own is not, which is the point.

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/clientAccess');
const typeScale = require('../services/typeScale');

const COMPANY_KEY = 'UI_TYPE_SCALE';

// Stored as plain JSON, unlike every other row in platform_settings.
//
// Everything else in that table is a credential and goes through encrypt().
// Five integers describing font sizes are not a secret, and encrypting them
// buys a real failure mode: a rotated or missing ENCRYPTION_KEY turns the
// house scale into silence, and the screen that reports it is the screen
// rendering at the default size. Nothing reads this key through getSetting(),
// which is the only thing that would be confused by a plain value.
async function readCompany() {
  try {
    const { rows } = await db.query('SELECT value FROM platform_settings WHERE key = $1', [COMPANY_KEY]);
    if (!rows.length) return {};
    const parsed = JSON.parse(rows[0].value);
    // Sanitised on the way out as well as in. A bound tightened after a value
    // was stored would otherwise keep serving the old out-of-range number.
    return typeScale.sanitise(parsed).values;
  } catch {
    return {};
  }
}

async function readUser(userId) {
  try {
    const { rows } = await db.query('SELECT ui_prefs FROM users WHERE id = $1', [userId]);
    if (!rows.length) return {};
    const prefs = rows[0].ui_prefs || {};
    return typeScale.sanitise(prefs.type_scale || {}).values;
  } catch {
    return {};
  }
}

router.use(authenticate);

router.get('/type-scale', async (req, res) => {
  try {
    const [company, user] = await Promise.all([readCompany(), readUser(req.user.id)]);
    res.json({
      ...typeScale.catalogue(),
      company,
      user,
      effective: typeScale.resolve(company, user),
      can_edit_company: req.user.role === 'admin',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/type-scale/me', async (req, res) => {
  try {
    const { values, ignored } = typeScale.sanitise(req.body?.values);
    // Replace rather than merge: the editor sends every token it is overriding,
    // so a token missing from the payload is one the user has just reset. A
    // merge would make a reset impossible without a second endpoint.
    await db.query(
      `UPDATE users
          SET ui_prefs = COALESCE(ui_prefs, '{}'::jsonb) || jsonb_build_object('type_scale', $2::jsonb)
        WHERE id = $1`,
      [req.user.id, JSON.stringify(values)]
    );
    const company = await readCompany();
    res.json({ user: values, effective: typeScale.resolve(company, values), ignored });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/type-scale/company', requireAdmin, async (req, res) => {
  try {
    const { values, ignored } = typeScale.sanitise(req.body?.values);
    await db.query(
      `INSERT INTO platform_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [COMPANY_KEY, JSON.stringify(values)]
    );
    const user = await readUser(req.user.id);
    res.json({ company: values, effective: typeScale.resolve(values, user), ignored });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
