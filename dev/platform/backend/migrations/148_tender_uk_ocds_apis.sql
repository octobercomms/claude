-- Pivot UK ingest to the official OCDS APIs. D3 only mirrors these and its
-- search is a JS SPA we can't reliably scrape, so it never surfaced the good
-- notices. Find a Tender (the UK-wide firehose, filtered locally to the niche)
-- and Contracts Finder (keyword search) are the real sources.

UPDATE tender_sources
  SET enabled = false, last_status = 'retired — replaced by Find a Tender / Contracts Finder'
  WHERE name = 'D3 Tenders (UK)';

INSERT INTO tender_sources (name, kind, market, endpoint, config, enabled) VALUES
  ('Find a Tender (UK)', 'api', 'uk', 'https://www.find-tender.service.gov.uk',
     '{"mode":"firehose","listUrl":"https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=tender","noticeBase":"https://www.find-tender.service.gov.uk/Notice/","sinceDays":45,"maxPages":150,"country":"United Kingdom"}'::jsonb, true),
  ('Contracts Finder (UK)', 'api', 'uk', 'https://www.contractsfinder.service.gov.uk',
     '{"mode":"keyword","base":"https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search","noticeBase":"https://www.contractsfinder.service.gov.uk/Notice/","searchTerms":["public relations","media relations","communications agency","marketing communications","press office","strategic communications","brand strategy","destination marketing","audience development"],"maxPagesPerTerm":2,"sinceDays":60,"country":"United Kingdom"}'::jsonb, true)
ON CONFLICT (name) DO NOTHING;
