-- Per-client rank-check cadence.
--
-- Rank checks ran on one global cron every 4 days, over every active keyword
-- of every active client: 861 keywords across 11 clients, about $59.90 a month
-- of DataForSEO. That rate is right for a client in an active SEO push and
-- wasteful for one being kept warm, and a single global number cannot be both.
--
-- rank_check_days is how many days must pass before a client's keywords are
-- re-checked. The cron becomes daily and asks, per client, whether they are
-- due. Useful values:
--
--     1   daily        — an active push, roughly 30 checks a month
--     4   the old rate — kept as the default so this migration changes nothing
--    15   twice a month
--    30   monthly      — a quarter of the old cost
--     0   paused       — no rank checks and no AI Overview checks
--
-- Any positive number works; those are just the ones the UI offers.
--
-- Default 4 deliberately: deploying this must not silently change what any
-- client costs or how often their data refreshes. Lowering the bill is an
-- explicit act per client, done on the Keyword spend panel where the cost of
-- each choice is shown next to it.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS rank_check_days INT NOT NULL DEFAULT 4;

COMMENT ON COLUMN clients.rank_check_days IS
  'Days between SEO rank checks for this client. 0 pauses rank and AI Overview checks entirely.';

-- Guard against a negative, which would make every client permanently due and
-- turn the daily cron into a daily full sweep — the opposite of the point.
ALTER TABLE clients
  DROP CONSTRAINT IF EXISTS clients_rank_check_days_sane;
ALTER TABLE clients
  ADD CONSTRAINT clients_rank_check_days_sane CHECK (rank_check_days >= 0 AND rank_check_days <= 365);
