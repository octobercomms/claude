const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { decrypt } = require('../utils/encryption');
const connectorFactory = require('../connectors');
const google = require('../connectors/google');

router.use(authenticate);

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
    const ga4 = connectors.find(c => c.connector_type === 'ga4');
    const ecom = connectors.find(c => c.connector_type === 'shopify' || c.connector_type === 'woocommerce');

    if (ga4) {
      try {
        const creds = decrypt(ga4.credentials);
        const propertyId = ga4.config && ga4.config.value;
        const data = await google.fetchGA4Daily(creds, { propertyId, startDate, endDate });
        const dailyMap = {};
        const channelMap = {};
        let tSessions = 0, tUsers = 0, tOrders = 0, tRevenue = 0;
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
      } catch (err) {
        result.notes.push(`GA4: ${err.message}`);
      }
    } else {
      result.notes.push('No GA4 connector — connect GA4 for traffic and trend data.');
    }

    if (ecom) {
      try {
        const creds = decrypt(ecom.credentials);
        const mod = connectorFactory.get(ecom.connector_type);
        const data = await mod.fetchData(creds, { connectorType: ecom.connector_type, startDate, endDate });
        const summary = (data && data.summary) || data || {};
        const revenue = Number(summary.total_revenue || summary.revenue || 0);
        const orders = Number(summary.total_orders || summary.orders || 0);
        if (revenue) result.kpis.revenue = Math.round(revenue);
        if (orders) result.kpis.orders = orders;
      } catch (err) {
        result.notes.push(`${ecom.connector_type}: ${err.message}`);
      }
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
