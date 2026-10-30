// One search endpoint over every record a user can see.
//
// Deliberately thin. The scoping and the SQL live in services/globalSearch.js
// so there is one place to read when asking "can this leak", and the route is
// just authentication, the query string, and a cap.
//
// Screens are not searched here — the browser matches those against
// nav/sections.js, which already holds all 91 and needs no round trip.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds } = require('../middleware/clientAccess');
const globalSearch = require('../services/globalSearch');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);

router.get('/', async (req, res) => {
  try {
    // visibleClientIds is what the middleware worked out for this user, never
    // anything the caller sent. A client login sees its own client and no
    // other, whatever it puts in the query string.
    const results = await globalSearch.search(req.query.q, {
      visibleClientIds: req.visibleClientIds,
    });
    res.json({ results });
  } catch (err) {
    console.error('[search] failed:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
