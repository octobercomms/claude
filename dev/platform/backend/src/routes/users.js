const express = require('express');
const { authenticate } = require('../middleware/auth');
const users = require('../services/users');

const router = express.Router();

router.use(authenticate);

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

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
