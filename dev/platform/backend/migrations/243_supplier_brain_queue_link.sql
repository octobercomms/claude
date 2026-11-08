-- Link the reconcile queue to the supplier brain so corrections flow back.

ALTER TABLE acct_reconcile_queue
  ADD COLUMN IF NOT EXISTS supplier_id bigint REFERENCES acct_suppliers(id);

CREATE INDEX IF NOT EXISTS acct_queue_supplier_idx
  ON acct_reconcile_queue (supplier_id);

-- Widen match_source to include supplier brain tiers.
ALTER TABLE acct_reconcile_queue
  DROP CONSTRAINT IF EXISTS acct_reconcile_queue_match_source_check;

ALTER TABLE acct_reconcile_queue
  ADD CONSTRAINT acct_reconcile_queue_match_source_check
  CHECK (match_source IN ('rule', 'ai', 'manual', 'supplier_t1', 'supplier_t2'));
