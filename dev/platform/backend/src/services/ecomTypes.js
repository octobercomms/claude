// Which connectors are a shop.
//
// This existed as the literal `c.connector_type === 'shopify' || c.connector_type === 'woocommerce'`
// in five places: the sales-and-traffic route, the report builder, the report
// template chooser, and the analyst's tool schema twice over. Adding Stripe
// meant editing all five and hoping, which is how a list drifts — the sixth
// call site added next year inherits whichever version its author copied.
//
// So it is one list. A connector that reports revenue, orders and an average
// order value belongs in it; one that reports traffic or spend does not.

const ECOM_TYPES = ['shopify', 'woocommerce', 'stripe'];

function isEcom(type) {
  return ECOM_TYPES.includes(type);
}

// Which of a client's connectors are shops, in the order they came back.
function ecomConnectors(connectors) {
  return (connectors || []).filter(c => isEcom(c.connector_type));
}

module.exports = { ECOM_TYPES, isEcom, ecomConnectors };
