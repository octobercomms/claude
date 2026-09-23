// Book-a-call admin (docs/omi/booking.md): calendar connection, availability
// rules, upcoming bookings. Admin-only.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/clientAccess');
const booking = require('../services/booking');
const gcal = require('../services/googleCalendar');

const router = express.Router();
router.use(authenticate, requireAdmin);

router.get('/status', async (req, res) => {
  try { res.json(await gcal.status()); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/disconnect', async (req, res) => {
  try { await gcal.disconnect(); res.json({ connected: false }); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/settings', async (req, res) => {
  try { res.json({ config: await booking.getConfig(), budgets: booking.BUDGETS }); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/settings', async (req, res) => {
  try { res.json({ config: await booking.saveConfig(req.body || {}) }); } catch (err) { res.status(400).json({ error: err.message }); }
});
router.get('/upcoming', async (req, res) => {
  try { res.json(await booking.upcoming()); } catch (err) { res.status(500).json({ error: err.message }); }
});
// Preview what visitors see right now (uses the live calendar).
router.get('/slots', async (req, res) => {
  try { res.json(await booking.slots()); } catch (err) { res.status(err.code === 'NOT_CONNECTED' ? 409 : 502).json({ error: err.message }); }
});

module.exports = router;
