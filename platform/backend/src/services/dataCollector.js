const pool = require('../db');
const { decrypt } = require('../utils/encryption');
const connectorFactory = require('../connectors');
const emailService = require('./emailService');

async function collectClientData(clientId, periodStart, periodEnd) {
  const { rows: connectors } = await pool.query(
    `SELECT c.*, cl.name as client_name
     FROM connectors c
     JOIN clients cl ON cl.id = c.client_id
     WHERE c.client_id = $1 AND c.status = 'active'`,
    [clientId]
  );

  const { rows: clientRows } = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  const client = clientRows[0];

  const results = {};
  const errors = {};

  for (const connector of connectors) {
    const key = connector.store_label
      ? `${connector.connector_type}:${connector.store_label}`
      : connector.connector_type;

    try {
      const creds = decrypt(connector.credentials);
      if (!creds) {
        errors[key] = 'No credentials configured';
        continue;
      }

      // Special handling for Meta: check validity and alert if expired
      if (['meta_ads', 'instagram_insights'].includes(connector.connector_type)) {
        try {
          const metaConnector = connectorFactory.get(connector.connector_type);
          await metaConnector.checkTokenValidity(creds);
        } catch (tokenErr) {
          await pool.query(
            'UPDATE connectors SET status = $1, error_message = $2 WHERE id = $3',
            ['expired', tokenErr.message, connector.id]
          );

          // Send alert email
          const reauthUrl = `${process.env.PLATFORM_URL}/auth/meta/reauth?client_id=${clientId}`;
          await emailService.sendMetaTokenAlert({
            clientName: client.name,
            connectorType: connector.connector_type,
            reauthoriseUrl: reauthUrl,
          }).catch(err => console.error('Alert email failed:', err.message));

          errors[key] = `Meta token expired: ${tokenErr.message}`;
          continue;
        }
      }

      const connectorModule = connectorFactory.get(connector.connector_type);
      const config = connector.config || {};
      const data = await connectorModule.fetchData(creds, {
        connectorType: connector.connector_type,
        startDate: periodStart,
        endDate: periodEnd,
        storeLabel: connector.store_label,
        // Pass saved account/property selections
        propertyId: config.value,   // GA4
        siteUrl: config.value,      // Google Search Console
        customerId: config.value,   // Google Ads
        merchantId: config.value,   // Google Merchant Center
        adAccountId: config.value,  // Meta Ads
        accountId: config.value,    // Instagram
      });

      results[key] = data;

      // Update last_checked
      await pool.query(
        'UPDATE connectors SET last_checked = NOW(), error_message = NULL WHERE id = $1',
        [connector.id]
      );
    } catch (err) {
      console.error(`Data collection failed for ${key}:`, err.message);
      errors[key] = err.message;

      await pool.query(
        'UPDATE connectors SET status = $1, error_message = $2 WHERE id = $3',
        ['error', err.message, connector.id]
      );
    }
  }

  return { data: results, errors };
}

function buildReportSections(collectedData, connectorErrors) {
  const CONNECTOR_LABELS = {
    ga4: 'Google Analytics 4',
    google_search_console: 'Google Search Console',
    google_ads: 'Google Ads',
    google_merchant_center: 'Google Merchant Center',
    meta_ads: 'Meta Ads',
    instagram_insights: 'Instagram Insights',
    shopify: 'Shopify',
    shopify_email: 'Shopify Email',
    woocommerce: 'WooCommerce',
    klaviyo: 'Klaviyo',
    brevo: 'Brevo',
    amazon_seller: 'Amazon Seller',
  };

  const sections = [];

  for (const [key, data] of Object.entries(collectedData.data)) {
    const [type, storeLabel] = key.split(':');
    sections.push({
      title: CONNECTOR_LABELS[type] || type,
      storeLabel: storeLabel || null,
      data,
      metrics: extractKeyMetrics(type, data),
      tables: extractTables(type, data),
      unavailable: false,
    });
  }

  // Add unavailable sections for errors
  for (const [key, errorMsg] of Object.entries(collectedData.errors)) {
    const [type, storeLabel] = key.split(':');
    sections.push({
      title: CONNECTOR_LABELS[type] || type,
      storeLabel: storeLabel || null,
      data: null,
      unavailable: true,
      errorMessage: errorMsg,
    });
  }

  return sections;
}

function extractKeyMetrics(connectorType, data) {
  if (!data) return [];

  switch (connectorType) {
    case 'shopify':
    case 'woocommerce': {
      const s = data.summary || {};
      return [
        { label: 'Total Revenue', value: formatCurrency(s.total_revenue) },
        { label: 'Orders', value: s.total_orders || 0 },
        { label: 'Avg Order Value', value: formatCurrency(s.avg_order_value) },
      ];
    }
    case 'meta_ads': {
      const rows = data.data || [];
      const totals = rows.reduce((acc, r) => {
        acc.spend += parseFloat(r.spend || 0);
        acc.clicks += parseInt(r.clicks || 0);
        acc.impressions += parseInt(r.impressions || 0);
        return acc;
      }, { spend: 0, clicks: 0, impressions: 0 });
      return [
        { label: 'Ad Spend', value: formatCurrency(totals.spend) },
        { label: 'Clicks', value: totals.clicks.toLocaleString() },
        { label: 'Impressions', value: totals.impressions.toLocaleString() },
      ];
    }
    default:
      return [];
  }
}

function extractTables(connectorType, data) {
  if (!data) return [];

  switch (connectorType) {
    case 'shopify':
    case 'woocommerce': {
      const orders = (data.orders || []).slice(0, 20);
      if (!orders.length) return [];
      return [{
        heading: 'Recent Orders',
        headers: ['Order ID', 'Date', 'Status', 'Total'],
        rows: orders.map(o => [
          o.order_number || o.id,
          new Date(o.created_at).toLocaleDateString('en-GB'),
          o.financial_status || o.status,
          formatCurrency(o.total_price || o.total),
        ]),
      }];
    }
    case 'meta_ads': {
      const campaigns = (data.data || []).slice(0, 20);
      if (!campaigns.length) return [];
      return [{
        heading: 'Campaign Performance',
        headers: ['Campaign', 'Spend', 'Impressions', 'Clicks', 'CTR'],
        rows: campaigns.map(c => [
          c.campaign_name,
          formatCurrency(c.spend),
          parseInt(c.impressions || 0).toLocaleString(),
          parseInt(c.clicks || 0).toLocaleString(),
          `${parseFloat(c.ctr || 0).toFixed(2)}%`,
        ]),
      }];
    }
    default:
      return [];
  }
}

function formatCurrency(val) {
  const n = parseFloat(val || 0);
  if (isNaN(n)) return '£0.00';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);
}

module.exports = { collectClientData, buildReportSections };
