const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const { decrypt } = require('../utils/encryption');
const connectorFactory = require('../connectors');
const google = require('../connectors/google');

router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

// Aggregated GA4 + ecommerce data for the client Sales & Traffic dashboard.
router.get('/:clientId', async (req, res) => {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  let startDate, endDate;
  if (iso.test(req.query.start || '') && iso.test(req.query.end || '')) {
    startDate = req.query.start;
    endDate = req.query.end;
    if (startDate > endDate) { const t = startDate; startDate = endDate; endDate = t; }
  } else {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 366);
    startDate = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    endDate = new Date().toISOString().slice(0, 10);
  }

  const result = {
    range: { start: startDate, end: endDate },
    kpis: {}, trafficTrend: [], salesTrend: [], channels: [], notes: [],
  };

  try {
    const { rows: connectors } = await pool.query(
      "SELECT * FROM connectors WHERE client_id = $1 AND status = 'active'",
      [req.params.clientId]
    );
    // Falcon-style multi-market clients have multiple GA4 properties
    // (B2B / B2C) and multiple Shopify stores (UK / US / EU × B2C / B2B).
    // The earlier code used `connectors.find(...)` and only read the
    // first match — which on a multi-store client meant 5,000+ sessions
    // in GA4 reading through as ~35 on the dashboard. Sum across all
    // active connectors of each type.
    const ga4Connectors = connectors.filter(c => c.connector_type === 'ga4');
    const ecomConnectors = connectors.filter(c => c.connector_type === 'shopify' || c.connector_type === 'woocommerce');

    if (ga4Connectors.length) {
      const dailyMap = {};
      const channelMap = {};
      let tSessions = 0, tUsers = 0, tOrders = 0, tRevenue = 0;
      const errors = [];
      await Promise.all(ga4Connectors.map(async (ga4) => {
        try {
          const creds = decrypt(ga4.credentials);
          const propertyId = ga4.config && ga4.config.value;
          if (!propertyId) { errors.push(`${ga4.store_label || 'ga4'}: no property selected`); return; }
          const data = await google.fetchGA4Daily(creds, { propertyId, startDate, endDate });
          for (const row of data.rows || []) {
            const dv = row.dimensionValues || [];
            const mv = row.metricValues || [];
            const raw = dv[0] ? dv[0].value : '';
            const channel = (dv[1] && dv[1].value) || 'Unknown';
            const sessions = Number((mv[0] && mv[0].value) || 0);
            const users = Number((mv[1] && mv[1].value) || 0);
            const orders = Number((mv[2] && mv[2].value) || 0);
            const revenue = Number((mv[3] && mv[3].value) || 0);
            const date = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
            const d = dailyMap[date] || (dailyMap[date] = { date, sessions: 0, users: 0, revenue: 0, orders: 0 });
            d.sessions += sessions; d.users += users; d.revenue += revenue; d.orders += orders;
            channelMap[channel] = (channelMap[channel] || 0) + sessions;
            tSessions += sessions; tUsers += users; tOrders += orders; tRevenue += revenue;
          }
        } catch (err) {
          errors.push(`${ga4.store_label || 'ga4'}: ${err.message}`);
        }
      }));
      const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
      result.trafficTrend = daily.map(d => ({ date: d.date, sessions: d.sessions, users: d.users }));
      result.salesTrend = daily.map(d => ({ date: d.date, revenue: Math.round(d.revenue), orders: d.orders }));
      result.channels = Object.entries(channelMap)
        .map(([channel, sessions]) => ({ channel, sessions }))
        .sort((a, b) => b.sessions - a.sessions);
      result.kpis.sessions = tSessions;
      result.kpis.users = tUsers;
      result.kpis.conversionRate = tSessions ? (tOrders / tSessions) * 100 : 0;
      result.kpis.revenue = Math.round(tRevenue);
      result.kpis.orders = tOrders;
      for (const e of errors) result.notes.push(`GA4: ${e}`);
    } else {
      result.notes.push('No GA4 connector — connect GA4 for traffic and trend data.');
    }

    if (ecomConnectors.length) {
      // Sum total_revenue and total_orders across every Shopify / Woo
      // store. Each connector reports its own market in its account
      // currency — for Falcon that's all GBP, so a plain sum works.
      // Mixed-currency multi-store clients would need fxRates here too
      // (same pattern as the renderer in PR #307); not yet a need.
      let revenue = 0, orders = 0;
      await Promise.all(ecomConnectors.map(async (ecom) => {
        try {
          const creds = decrypt(ecom.credentials);
          const mod = connectorFactory.get(ecom.connector_type);
          const data = await mod.fetchData(creds, { connectorType: ecom.connector_type, startDate, endDate });
          const summary = (data && data.summary) || data || {};
          revenue += Number(summary.total_revenue || summary.revenue || 0);
          orders += Number(summary.total_orders || summary.orders || 0);
        } catch (err) {
          result.notes.push(`${ecom.connector_type}${ecom.store_label ? ' (' + ecom.store_label + ')' : ''}: ${err.message}`);
        }
      }));
      if (revenue) result.kpis.revenue = Math.round(revenue);
      if (orders) result.kpis.orders = orders;
    } else {
      result.notes.push('No ecommerce connector — revenue figures are taken from GA4.');
    }

    result.kpis.aov = result.kpis.orders ? Math.round((result.kpis.revenue || 0) / result.kpis.orders) : 0;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
