-- Structured company details for bids — the SQ/selection-questionnaire facts
-- every public-sector tender asks for (legal name, company number, VAT,
-- registered address, directors, insurances, accreditations, policies…). Kept
-- structured (not in the free-text profile) so the bid agent uses them verbatim
-- and never invents a registration or VAT number.
ALTER TABLE tender_org_profile
  ADD COLUMN IF NOT EXISTS company_json JSONB NOT NULL DEFAULT '{}'::jsonb;
