-- What a connected WordPress site is actually running.
--
-- October ships plugins to client sites and had no way of knowing what PHP any
-- of them ran. That stopped being an academic gap on 21 Oct 2026, when two
-- unauthenticated RCEs in PHP (CVE-2026-109618, CVE-2026-109619, CVSSv4 9.2)
-- were published with working exploits demonstrated through WordPress. The
-- only answer to "which of our clients are exposed" was to ring round.
--
-- The plugin already sent its own version and WordPress's at pairing and the
-- platform threw both away. These columns keep them, plus PHP, and the shared
-- envelope on every signed push refreshes them, so the answer stays true when
-- a host upgrades rather than ageing from the day a site was paired.
--
-- Not secret, so plain columns rather than the encrypted credentials blob:
-- a value read on every push should not cost a decrypt and re-encrypt, and a
-- write to that blob risks clobbering the pairing secret beside it.

ALTER TABLE connectors ADD COLUMN IF NOT EXISTS php_version      TEXT;
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS wp_version       TEXT;
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS plugin_version   TEXT;
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS versions_seen_at TIMESTAMPTZ;
