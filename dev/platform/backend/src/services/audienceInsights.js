// Audience Insights — the Outra-substitute for the Paid suite. Three
// layers stacked:
//   1. First-party postcode distribution from Shopify orders (live this
//      commit) — answers "where are our customers concentrated"
//   2. Saved audience_segments — AM-defined criteria saved per client
//   3. UK postcode-level demographic overlay (next commit) — ONS data
//      joined to the distribution so segments can filter by income /
//      household type / age band
//
// The cache table keeps the live aggregation snappy: first request
// triggers a walk of every order in the last 365 days, subsequent
// requests in the same day serve the cached snapshot.

const pool = require('../db');
const { decrypt } = require('../utils/encryption');
const shopify = require('../connectors/shopify');

const CACHE_TTL_HOURS = 24;

async function getShopifyCreds(clientId) {
  const { rows } = await pool.query(
    `SELECT credentials FROM connectors
      WHERE client_id = $1 AND connector_type = 'shopify' AND status = 'active'
      LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return null;
  return decrypt(rows[0].credentials);
}

// Aggregate first-party postcodes for a client. Uses the cache when
// available; pass force=true to recompute.
async function getPostcodeDistribution(clientId, { force = false } = {}) {
  if (!force) {
    const { rows: cached } = await pool.query(
      `SELECT * FROM audience_postcode_cache WHERE client_id = $1`,
      [clientId]
    );
    const c = cached[0];
    if (c && Date.now() - new Date(c.computed_at).getTime() < CACHE_TTL_HOURS * 60 * 60 * 1000) {
      return {
        postcodes: c.postcodes || [],
        total_orders: c.total_orders,
        total_revenue: Number(c.total_revenue),
        computed_at: c.computed_at,
        from_cache: true,
      };
    }
  }
  const creds = await getShopifyCreds(clientId);
  if (!creds) {
    return { postcodes: [], total_orders: 0, total_revenue: 0, computed_at: null, note: 'No active Shopify connector — first-party audience needs a Shopify connection.' };
  }
  const customers = await shopify.fetchCustomerPostcodes(creds, { days: 365 });
  const byDistrict = new Map();
  for (const c of customers) {
    const d = c.postcode_district;
    if (!d) continue;
    const e = byDistrict.get(d) || { postcode_district: d, customer_count: 0, order_count: 0, revenue: 0 };
    e.customer_count += 1;
    e.order_count += c.order_count;
    e.revenue += c.revenue;
    byDistrict.set(d, e);
  }
  const postcodes = [...byDistrict.values()]
    .map(p => ({ ...p, revenue: Math.round(p.revenue * 100) / 100 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 200);    // cap at 200 districts to keep the payload small
  const totalOrders = customers.reduce((n, c) => n + c.order_count, 0);
  const totalRevenue = customers.reduce((n, c) => n + c.revenue, 0);

  await pool.query(
    `INSERT INTO audience_postcode_cache (client_id, postcodes, total_orders, total_revenue, computed_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (client_id) DO UPDATE
       SET postcodes = EXCLUDED.postcodes,
           total_orders = EXCLUDED.total_orders,
           total_revenue = EXCLUDED.total_revenue,
           computed_at = NOW()`,
    [clientId, JSON.stringify(postcodes), totalOrders, totalRevenue]
  );
  return {
    postcodes,
    total_orders: totalOrders,
    total_revenue: Math.round(totalRevenue * 100) / 100,
    computed_at: new Date().toISOString(),
    from_cache: false,
  };
}

// Apply a segment's filters against the cached distribution. Returns
// the matching postcodes + a reach estimate. Filters supported in this
// commit: postcode_districts[] (explicit list), min_revenue (sum of
// revenue from postcode), min_customers. Demographic filters (income,
// age band) plug in once the ONS overlay is loaded.
function applySegmentFilters(distribution, filters = {}) {
  if (!distribution?.postcodes?.length) return { postcodes: [], reach: 0 };
  const allowed = Array.isArray(filters.postcode_districts) && filters.postcode_districts.length
    ? new Set(filters.postcode_districts.map(s => String(s).toUpperCase()))
    : null;
  const minRev = Number(filters.min_revenue || 0);
  const minCust = Number(filters.min_customers || 0);
  const matched = distribution.postcodes.filter(p => {
    if (allowed && !allowed.has(p.postcode_district)) return false;
    if (minRev > 0 && p.revenue < minRev) return false;
    if (minCust > 0 && p.customer_count < minCust) return false;
    return true;
  });
  const reach = matched.reduce((n, p) => n + p.customer_count, 0);
  return { postcodes: matched, reach };
}

async function listSegments(clientId) {
  const { rows } = await pool.query(
    `SELECT id, name, description, filters, estimated_reach, source, updated_at
       FROM audience_segments WHERE client_id = $1
       ORDER BY updated_at DESC`,
    [clientId]
  );
  return rows;
}

async function saveSegment(clientId, { id, name, description, filters, source = 'manual' }) {
  // Compute estimated_reach off the cached distribution if available.
  let estimatedReach = null;
  try {
    const dist = await getPostcodeDistribution(clientId);
    estimatedReach = applySegmentFilters(dist, filters).reach;
  } catch { /* leave null — UI handles absent estimate */ }
  if (id) {
    const { rows } = await pool.query(
      `UPDATE audience_segments
          SET name = $1, description = $2, filters = $3,
              estimated_reach = $4, source = $5, updated_at = NOW()
        WHERE id = $6 AND client_id = $7
        RETURNING id, name, description, filters, estimated_reach, source, updated_at`,
      [name, description || null, JSON.stringify(filters || {}), estimatedReach, source, id, clientId]
    );
    return rows[0];
  }
  const { rows } = await pool.query(
    `INSERT INTO audience_segments (client_id, name, description, filters, estimated_reach, source)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, description, filters, estimated_reach, source, updated_at`,
    [clientId, name, description || null, JSON.stringify(filters || {}), estimatedReach, source]
  );
  return rows[0];
}

async function deleteSegment(clientId, segmentId) {
  await pool.query(`DELETE FROM audience_segments WHERE id = $1 AND client_id = $2`, [segmentId, clientId]);
}

// Format a segment's matching postcodes as a CSV for Meta Custom
// Audience upload. Meta's "lookalike seed" format accepts ZIP+country
// per row — that's what we emit.
async function exportSegmentForMeta(clientId, segmentId, countryCode = 'GB') {
  const { rows } = await pool.query(
    `SELECT filters FROM audience_segments WHERE id = $1 AND client_id = $2`,
    [segmentId, clientId]
  );
  if (!rows.length) throw new Error('Segment not found');
  const dist = await getPostcodeDistribution(clientId);
  const { postcodes } = applySegmentFilters(dist, rows[0].filters);
  // CSV header per Meta spec. We dedupe by postcode so a busy district
  // doesn't get one row per customer.
  const lines = ['zip,country'];
  for (const p of postcodes) lines.push(`${p.postcode_district},${countryCode}`);
  return lines.join('\n');
}

module.exports = {
  getPostcodeDistribution, applySegmentFilters,
  listSegments, saveSegment, deleteSegment, exportSegmentForMeta,
};
