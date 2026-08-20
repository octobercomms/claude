-- Add Public Contracts Scotland + Sell2Wales — the Scotland/Wales portals D3
-- aggregated but the UK-wide Find a Tender misses for below-threshold notices
-- (e.g. the River Tweed brand/audience job). Both run the same Scottish
-- Government OCDS API: /v1/Notices?dateFrom=mm-yyyy&outputType=0 (0 = OCDS).
INSERT INTO tender_sources (name, kind, market, endpoint, config, enabled) VALUES
  ('Public Contracts Scotland', 'api', 'uk', 'https://api.publiccontractsscotland.gov.uk',
     '{"mode":"firehose","listUrl":"https://api.publiccontractsscotland.gov.uk/v1/Notices?outputType=0","windowParam":"dateFrom","windowFormat":"mm-yyyy","sinceDays":75,"maxPages":3,"noticeBase":"https://www.publiccontractsscotland.gov.uk/","country":"United Kingdom"}'::jsonb, true),
  ('Sell2Wales', 'api', 'uk', 'https://api.sell2wales.gov.wales',
     '{"mode":"firehose","listUrl":"https://api.sell2wales.gov.wales/v1/Notices?outputType=0&locale=2057","windowParam":"dateFrom","windowFormat":"mm-yyyy","sinceDays":75,"maxPages":3,"noticeBase":"https://www.sell2wales.gov.wales/","country":"United Kingdom"}'::jsonb, true)
ON CONFLICT (name) DO NOTHING;
