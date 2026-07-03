const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const users = require('../services/users');

const router = express.Router();

router.use(authenticate);

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// Invite a read-only client by email — creates the client-role user and emails
// them a one-time set-password link. Returns the link too, so the AM can copy
// it if the email doesn't arrive.
router.post('/invite', requireAdmin, async (req, res) => {
  const { email, clientIds } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  if (!Array.isArray(clientIds) || !clientIds.length) return res.status(400).json({ error: 'assign at least one client' });
  try {
    const created = await users.inviteClient({ email, clientIds });
    const base = (process.env.PLATFORM_URL || 'https://platform.octobercomms.com').replace(/\/$/, '');
    const link = `${base}/set-password/${created.invite_token}`;
    let emailed = false, emailError = null;
    try {
      const cn = (await pool.query('SELECT name FROM clients WHERE id = $1', [clientIds[0]])).rows[0]?.name || '';
      await require('../services/emailService').sendClientInvite({ to: created.email, clientName: cn, link });
      emailed = true;
    } catch (e) { emailError = e.message; }
    res.status(201).json({ user: { id: created.id, username: created.username, email: created.email, role: created.role }, link, emailed, emailError });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'a user with that email already exists' });
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/', requireAdmin, async (req, res) => {
  try {
    res.json(await users.listAll());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  const { username, password, role, clientIds } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (role && !['admin', 'viewer', 'client'].includes(role)) return res.status(400).json({ error: 'invalid role' });
  // A read-only client login must be tied to at least one client — otherwise
  // it can see nothing and serves no purpose.
  if (role === 'client' && !(Array.isArray(clientIds) && clientIds.length)) {
    return res.status(400).json({ error: 'a client login must be assigned at least one client' });
  }
  try {
    const created = await users.create({ username, password, role, clientIds });
    res.status(201).json(created);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'username already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  const { password, role, clientIds } = req.body || {};
  if (role && !['admin', 'viewer', 'client'].includes(role)) return res.status(400).json({ error: 'invalid role' });
  try {
    const target = await users.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'user not found' });
    // Don't allow an admin to demote themselves and lock out admin access.
    if (target.id === req.user.id && role && role !== 'admin') {
      return res.status(400).json({ error: 'cannot change your own role' });
    }
    await users.update(req.params.id, { password, role, clientIds });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'cannot delete your own account' });
    const target = await users.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'user not found' });
    // Block deleting the env-backed admin — the boot upsert would just recreate it.
    if (target.username === process.env.ADMIN_USERNAME) {
      return res.status(400).json({ error: 'cannot delete the primary admin' });
    }
    await users.remove(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
