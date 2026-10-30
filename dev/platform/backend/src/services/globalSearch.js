// One search box over everything OMI holds.
//
// Screens are matched in the browser from nav/sections.js, which already knows
// all 91 of them. This is the other half: the records. Clients, journalists,
// releases, coverage, recordings, campaigns, transcripts and assets, ranked
// together so one query answers "where is that thing" whatever kind of thing
// it is.
//
// Two things shape the implementation.
//
// **Every row is scoped to what the caller may see.** This endpoint reaches
// across eight tables that each have their own route file and their own
// guards, so it is the one place where a mistake leaks one client's records to
// another. Every entity below filters on the caller's visible client ids —
// there is no "search everything and filter later" path, and the test asserts
// that the generated SQL for every entity carries the scope predicate.
//
// **The URL is not built here.** An entity names the section leaf and screen
// slug it lives on; the browser composes the path from nav/sections.js, which
// is the single source of truth for what a screen is called. A test checks
// every pair against that table, so renaming a screen cannot leave search
// pointing at a URL that resolves to the section default.
//
// The entity table itself is in globalSearch.entities.js, which requires
// nothing: that test runs in the frontend's CI job, where `pg` is not
// installed and loading this file fails.

const pool = require('../db');
const { ENTITIES } = require('./globalSearch.entities');

const PER_TYPE = 5;          // enough to recognise the one you meant
const TOTAL = 30;

// One SELECT per entity. $1 is the visible client ids, $2 the ILIKE pattern,
// $3 the raw query for the exact-match rank.
//
// The scope predicate is built here and nowhere else, so there is exactly one
// line to get right and the test can assert it appears in every branch.
// Parenthesised: each branch carries its own ORDER BY and LIMIT, and Postgres
// rejects those inside a UNION ALL arm unless the arm is wrapped. The tests
// that read this SQL as text could not see that — it took running it.
function selectFor(e) {
  const scope = `${e.scopeColumn || 'client_id'} = ANY($1::uuid[])`;
  const match = e.columns.map(c => `${c} ILIKE $2`).join(' OR ');
  const subtitle = e.subtitle ? `${e.subtitle}::text` : 'NULL::text';
  return `
    (SELECT '${e.type}'::text          AS type,
           id::text                   AS id,
           ${e.title}::text           AS title,
           ${subtitle}                AS subtitle,
           ${e.clientIdExpr || 'client_id'}::text AS client_id,
           '${e.leaf}'::text          AS leaf,
           '${e.screen}'::text        AS screen,
           created_at                 AS created_at,
           CASE WHEN lower(${e.title}) = lower($3) THEN 0
                WHEN lower(${e.title}) LIKE lower($3) || '%' THEN 1
                ELSE 2 END            AS rank
      FROM ${e.table}
     WHERE ${scope}
       AND ${e.title} IS NOT NULL AND ${e.title} <> ''
       AND (${match})
     ORDER BY rank, created_at DESC
     LIMIT ${PER_TYPE})`;
}

// Postgres rejects an empty array cast to uuid[] in ANY() with no type context
// in some positions, and more importantly an empty scope should return nothing
// rather than everything — so the caller never reaches SQL with one.
async function search(q, { visibleClientIds }) {
  const term = String(q || '').trim();
  if (term.length < 2) return [];
  const ids = Array.isArray(visibleClientIds) ? visibleClientIds.filter(Boolean) : [];
  if (!ids.length) return [];

  const sql = ENTITIES.map(selectFor).join('\n    UNION ALL\n');
  const { rows } = await pool.query(
    `SELECT * FROM (${sql}) s ORDER BY rank, created_at DESC LIMIT ${TOTAL}`,
    [ids, `%${term}%`, term]
  );
  // The group heading travels with the row. The alternative is a second
  // type -> label map in the browser, which is the same list written twice and
  // drifts the first time an entity is renamed.
  const labels = Object.fromEntries(ENTITIES.map(e => [e.type, e.label]));
  return rows.map(r => ({
    type: r.type,
    label: labels[r.type] || r.type,
    id: r.id,
    title: r.title,
    subtitle: r.subtitle || null,
    client_id: r.client_id,
    leaf: r.leaf,
    screen: r.screen,
  }));
}

module.exports = { search, ENTITIES, selectFor, PER_TYPE, TOTAL };
