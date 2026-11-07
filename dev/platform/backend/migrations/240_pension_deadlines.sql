-- Add PENSION as a valid tax_type for workplace pension contribution deadlines.
-- NEST (and other auto-enrolment providers) require monthly contributions
-- by the 22nd of the following month for electronic payments.
ALTER TABLE acct_tax_deadlines
  DROP CONSTRAINT IF EXISTS acct_tax_deadlines_tax_type_check;

ALTER TABLE acct_tax_deadlines
  ADD CONSTRAINT acct_tax_deadlines_tax_type_check
  CHECK (tax_type IN ('VAT', 'CT600', 'PAYE', 'SA', 'PENSION', 'OTHER'));
