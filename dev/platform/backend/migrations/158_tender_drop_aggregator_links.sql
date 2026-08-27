-- Null out notice links that point at aggregator / reseller sites (TenderSignal,
-- Infobrokers, Tussell, BidStats, …). Those gate the real source behind a signup
-- and their per-tender ids often mismatch the notice — one surfaced a National
-- Trust PR notice but linked to an unrelated £4.1m "Performance Marketing Agency"
-- tender. With the link nulled the row falls back to a title+buyer web search,
-- which is accurate. New notices are cleaned at ingest (sources/webSearch.js).
UPDATE tender_notices
   SET url = NULL
 WHERE url ~* '://[^/]*(tendersignal|infobrokers|tussell|bidstats|jorpex|govbid|biddingo|merx)\.';
