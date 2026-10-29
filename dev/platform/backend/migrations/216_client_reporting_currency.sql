-- The currency a client's money is reported in.
--
-- 215's sibling change made the connectors report their own store currency,
-- which fixed Architecture Tours showing USD revenue labelled in sterling. It
-- introduced a worse failure at the other end: the currency is only known when
-- an ecommerce connector reports it, but `kpis.revenue` is set from GA4
-- whether or not one does. A client whose revenue comes from GA4 — no Shopify
-- or Woo connector, or one that errored — went from a wrong symbol to no
-- symbol at all.
--
-- Currency is a property of the client, not of a connector. One client can
-- have six stores and still report in one currency, and the account lead knows
-- which. So it is stored here, and the connector-reported value is only the
-- default when this is unset.
--
-- Null means nobody has said: the figure then falls back to whatever the
-- connectors agree on, and shows unlabelled if they report nothing. Still
-- better than guessing sterling, which is the bug this whole thread started
-- with.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS reporting_currency TEXT;

-- ISO 4217 or nothing. A blank string or a symbol ('£') would reach the UI as
-- a label and be worse than null, so the shape is enforced here rather than
-- trusted from the form.
ALTER TABLE clients
  DROP CONSTRAINT IF EXISTS clients_reporting_currency_iso;
ALTER TABLE clients
  ADD CONSTRAINT clients_reporting_currency_iso
  CHECK (reporting_currency IS NULL OR reporting_currency ~ '^[A-Z]{3}$');
