// Shared client-visibility helpers. Used by per-client route files to enforce
// that the caller is allowed to touch the client referenced in the URL or body.
//
// Pattern used in each route file:
//   router.use(authenticate);
//   router.use(loadVisibleClientIds);
//   router.use(requireClientAccess({ paramNames: ['clientId', 'id'] }));
//
// For routes that take client_id in the body/query, call `assertClientAccess`
// inline before doing any work.

const users = require('../services/users');

async function loadVisibleClientIds(req, res, next) {
  try {
    req.visibleClientIds = await users.getVisibleClientIds(req.user);
    next();
  } catch (err) {
    next(err);
  }
}

// Middleware factory. Inspects the named URL params; if any of them looks
// like a client_id and isn't in the caller's scope, responds 403.
// `paramNames` defaults to ['clientId'].
function requireClientAccess({ paramNames = ['clientId'] } = {}) {
  return (req, res, next) => {
    for (const name of paramNames) {
      const value = req.params[name];
      if (!value) continue;
      if (!users.canAccessClient(req.visibleClientIds, value)) {
        return res.status(403).json({ error: 'Not authorised for this client' });
      }
    }
    next();
  };
}

// One-off check — call inside a handler when the client id arrives via
// req.query.client_id, req.body.client_id, or a joined DB row.
function assertClientAccess(req, clientId) {
  if (!users.canAccessClient(req.visibleClientIds, clientId)) {
    const err = new Error('Not authorised for this client');
    err.status = 403;
    throw err;
  }
}

// Middleware that inspects req.query.client_id and req.body.client_id (if
// either is present) and rejects if the caller can't see it. Used by route
// files where most endpoints pass the client via body/query rather than a
// URL param.
function checkClientIdFromBodyOrQuery(req, res, next) {
  const candidates = [req.query?.client_id, req.body?.client_id].filter(Boolean);
  for (const cid of candidates) {
    if (!users.canAccessClient(req.visibleClientIds, cid)) {
      return res.status(403).json({ error: 'Not authorised for this client' });
    }
  }
  next();
}

// Admin-only guard. Use on routes that mutate platform-wide state or
// expose cross-tenant data.
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

module.exports = { loadVisibleClientIds, requireClientAccess, assertClientAccess, checkClientIdFromBodyOrQuery, requireAdmin };
