const google = require('./google');
const meta = require('./meta');
const shopify = require('./shopify');
const woocommerce = require('./woocommerce');
const klaviyo = require('./klaviyo');
const brevo = require('./brevo');
const amazonSeller = require('./amazon');
const dataForSEO = require('./dataforseo');
const zohoInventory = require('./zoho_inventory');
const cin7 = require('./cin7');

const connectors = {
  ga4: google,
  google_search_console: google,
  google_ads: google,
  google_merchant_center: google,
  meta_ads: meta,
  instagram_insights: meta,
  shopify: shopify,
  shopify_email: shopify,
  woocommerce: woocommerce,
  klaviyo: klaviyo,
  brevo: brevo,
  amazon_seller: amazonSeller,
  dataforseo: dataForSEO,
  zoho_inventory: zohoInventory,
  cin7: cin7,
};

module.exports = {
  get(type) {
    const connector = connectors[type];
    if (!connector) throw new Error(`Unknown connector type: ${type}`);
    return connector;
  },
  all: connectors,
};
