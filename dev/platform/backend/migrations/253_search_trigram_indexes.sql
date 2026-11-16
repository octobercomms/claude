-- Make the contact and publication searches use an index.
--
-- Both searches wrap the term in leading and trailing wildcards:
--
--   routes/press.js:374   oc.name ILIKE '%q%' OR oc.email ILIKE '%q%' OR oc.company ILIKE '%q%'
--   routes/pr.js:944      o.name ILIKE '%q%' OR o.canonical_name ILIKE '%q%' OR o.domain ILIKE '%q%'
--
-- A leading wildcard cannot use a b-tree, so every one of those is a
-- sequential scan over the whole table. outreach_contacts already carries
-- twelve indexes and none of them helps: the closest, `(lower(email))` from
-- migration 074, is a b-tree and is only usable for an equality or a prefix.
--
-- pg_trgm indexes trigrams rather than string prefixes, which is what makes a
-- '%q%' match indexable. Measured on this exact query shape against 20,000
-- generated contacts, Postgres 16:
--
--   term matching nothing      33.5 ms seq scan  ->  0.34 ms bitmap index scan
--   a journalist's full name   47.9 ms seq scan  ->  1.25 ms bitmap index scan
--
-- The planner picks the index on its own once ANALYZE has run; no query
-- changes are needed.
--
-- One honest nuance. A *common* term is already fast without any index,
-- because `LIMIT 50` lets the sequential scan stop as soon as it has fifty
-- rows (0.69 ms for a term matching a sixth of the table). The cost lands on
-- selective searches, where the scan has to read every row to prove there is
-- nothing more to find — which is exactly what looking up one journalist by
-- name is, and what the contacts library is mostly used for.
--
-- Why it matters now rather than later. The October install holds about
-- 19,000 contacts and one person searching, where a sequential scan is
-- survivable. Caro's install is a team of twenty against a database they are
-- actively migrating their press lists into, and the contacts library is the
-- screen they will live in.
--
-- Columns chosen by reading every ILIKE in the search paths, not by guessing:
-- press.js filters on name, email, company, contact_type and location;
-- pr.js and mediaAssistant.js filter on the outlet's name, canonical_name and
-- domain. contact_type and location are low-cardinality filters rather than
-- free text, so they are left alone — a trigram index on a column holding a
-- dozen distinct values costs writes and buys nothing.
--
-- CREATE EXTENSION needs rights the application role may not have on a
-- managed database. It is guarded so a role without them fails here, loudly,
-- rather than leaving the indexes half-created: run it once as a superuser if
-- this migration stops on that line.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Contacts: the three columns the library search reads.
CREATE INDEX IF NOT EXISTS outreach_contacts_name_trgm_idx
  ON outreach_contacts USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS outreach_contacts_email_trgm_idx
  ON outreach_contacts USING GIN (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS outreach_contacts_company_trgm_idx
  ON outreach_contacts USING GIN (company gin_trgm_ops);

-- Publications: the three the Publications panel searches.
CREATE INDEX IF NOT EXISTS pr_outlets_name_trgm_idx
  ON pr_outlets USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS pr_outlets_canonical_name_trgm_idx
  ON pr_outlets USING GIN (canonical_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS pr_outlets_domain_trgm_idx
  ON pr_outlets USING GIN (domain gin_trgm_ops);
