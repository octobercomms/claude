/**
 * Guards that the SQL over the social tables only names columns that exist.
 *
 * This file exists because `socialReport.js` ordered a lateral by
 * `captured_at` and selected `e.engagement_rate`, and neither column has ever
 * been on `social_post_engagement` (migration 026 calls the timestamp
 * `fetched_at`, and the rate is derived in JS, not stored). Nothing caught it:
 * the query is a template literal, so it parses fine, and the report download
 * is the only thing that runs it, so the first person to see the failure was
 * Daniel pressing the button in production.
 *
 * The guard reads the schema out of the migrations, works out which alias is
 * bound to which table inside each SQL literal, and checks every column
 * reference against the real column set. It is deliberately conservative:
 * where an alias cannot be resolved, it says nothing rather than guessing.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MIG = path.join(ROOT, 'migrations');
const SRC = path.join(ROOT, 'src');

// The tables this guard covers. Narrow on purpose: a table whose shape is
// built up over many migrations in ways this parser does not model would
// produce false failures, which teaches the next agent to delete the guard.
const TABLES = ['social_posts', 'social_post_engagement'];

const NOT_A_COLUMN = new Set([
  'primary', 'unique', 'foreign', 'check', 'constraint', 'exclude', 'like',
]);

function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, '');
}

// ---- schema from the migrations ---------------------------------------

function schema() {
  const files = fs.readdirSync(MIG).filter(f => f.endsWith('.sql')).sort();
  const cols = new Map(); // table -> Set of columns
  const ensure = (t) => {
    if (!cols.has(t)) cols.set(t, new Set());
    return cols.get(t);
  };

  for (const file of files) {
    const sql = stripSqlComments(fs.readFileSync(path.join(MIG, file), 'utf8'));

    // CREATE TABLE [IF NOT EXISTS] name ( ... )
    const create = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(/gi;
    let m;
    while ((m = create.exec(sql))) {
      const table = m[1].toLowerCase();
      // Walk to the matching close paren so nested parens (types, defaults)
      // do not end the body early.
      let depth = 1;
      let i = create.lastIndex;
      for (; i < sql.length && depth > 0; i++) {
        if (sql[i] === '(') depth++;
        else if (sql[i] === ')') depth--;
      }
      const body = sql.slice(create.lastIndex, i - 1);
      // Split on top-level commas only.
      const items = [];
      let buf = '';
      depth = 0;
      for (const ch of body) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { items.push(buf); buf = ''; } else buf += ch;
      }
      items.push(buf);
      const set = ensure(table);
      for (const item of items) {
        const name = item.trim().split(/\s+/)[0]?.replace(/"/g, '').toLowerCase();
        if (name && !NOT_A_COLUMN.has(name)) set.add(name);
      }
    }

    // ALTER TABLE name ADD COLUMN [IF NOT EXISTS] col
    const add = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;
    while ((m = add.exec(sql))) ensure(m[1].toLowerCase()).add(m[2].toLowerCase());

    // ALTER TABLE name RENAME COLUMN a TO b
    const ren = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+RENAME\s+COLUMN\s+([a-z_][a-z0-9_]*)\s+TO\s+([a-z_][a-z0-9_]*)/gi;
    while ((m = ren.exec(sql))) {
      const set = ensure(m[1].toLowerCase());
      set.delete(m[2].toLowerCase());
      set.add(m[3].toLowerCase());
    }

    // ALTER TABLE name DROP COLUMN [IF EXISTS] col
    const drop = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;
    while ((m = drop.exec(sql))) ensure(m[1].toLowerCase()).delete(m[2].toLowerCase());
  }
  return cols;
}

// ---- the SQL in the source --------------------------------------------

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Template literals, which is how every query in this codebase is written.
function sqlLiterals(code) {
  const out = [];
  const re = /`([^`]*)`/g;
  let m;
  while ((m = re.exec(code))) {
    const body = m[1];
    if (/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(body)) {
      out.push({ body, index: m.index });
    }
  }
  return out;
}

const ALIAS_STOP = new Set([
  'on', 'where', 'order', 'group', 'having', 'limit', 'left', 'right', 'inner',
  'outer', 'join', 'lateral', 'cross', 'union', 'set', 'values', 'returning',
  'using', 'as', 'and', 'or', 'select', 'from',
]);

// alias -> table, for the tables this guard covers.
function aliases(sql) {
  const found = new Map();
  for (const table of TABLES) {
    // FROM/JOIN social_posts p
    const direct = new RegExp(`(?:FROM|JOIN)\\s+${table}\\s+(?:AS\\s+)?([a-z][a-z0-9_]*)`, 'gi');
    let m;
    while ((m = direct.exec(sql))) {
      const alias = m[1].toLowerCase();
      if (!ALIAS_STOP.has(alias)) found.set(alias, table);
    }
    // LEFT JOIN LATERAL ( SELECT ... FROM social_post_engagement ... ) e ON
    const lateral = new RegExp(`\\(\\s*SELECT[\\s\\S]*?FROM\\s+${table}[\\s\\S]*?\\)\\s*(?:AS\\s+)?([a-z][a-z0-9_]*)\\s+ON`, 'gi');
    while ((m = lateral.exec(sql))) {
      const alias = m[1].toLowerCase();
      if (!ALIAS_STOP.has(alias)) found.set(alias, table);
    }
  }
  return found;
}

// `SELECT * FROM <table> ... ORDER BY <col>` — a bare column inside a
// single-table subquery belongs to that table. This is the exact shape the
// bug was in, so it gets its own check.
function bareOrderBys(sql) {
  const out = [];
  for (const table of TABLES) {
    const re = new RegExp(`FROM\\s+${table}\\b([\\s\\S]*?)ORDER\\s+BY\\s+([a-z_][a-z0-9_]*)(?![a-z0-9_]*\\s*[.(])`, 'gi');
    let m;
    while ((m = re.exec(sql))) {
      // A qualified reference (`p.published_at`) is the aliased check's job,
      // not this one's; here only a bare column counts.
      // Only when nothing between the FROM and the ORDER BY introduces
      // another table, so the column can only be this table's.
      if (/\b(JOIN|FROM)\b/i.test(m[1])) continue;
      const column = m[2].toLowerCase();
      // An ORDER BY may name an output alias from the select list
      // (`COUNT(*) AS posts ... ORDER BY posts`), which is not a column.
      if (new RegExp(`\\bAS\\s+${column}\\b`, 'i').test(sql)) continue;
      out.push({ table, column });
    }
  }
  return out;
}

const SCHEMA = schema();
const FILES = jsFiles(SRC);

test('the migrations really do describe the social tables', () => {
  for (const table of TABLES) {
    const set = SCHEMA.get(table);
    assert.ok(set && set.size > 3, `no columns parsed for ${table}; the parser, not the schema, is probably wrong`);
    assert.ok(set.has('id'), `${table} has no id column, which means the parse went wrong`);
  }
  assert.ok(SCHEMA.get('social_post_engagement').has('fetched_at'),
    'social_post_engagement should carry fetched_at');
  assert.ok(!SCHEMA.get('social_post_engagement').has('captured_at'),
    'nothing has ever added captured_at; if that changed, this guard needs rereading');
  assert.ok(!SCHEMA.get('social_post_engagement').has('engagement_rate'),
    'the engagement rate is derived in JS, not stored');
});

test('every aliased column over the social tables exists', () => {
  const bad = [];
  for (const file of FILES) {
    const code = fs.readFileSync(file, 'utf8');
    for (const lit of sqlLiterals(code)) {
      const sql = stripSqlComments(lit.body);
      const map = aliases(sql);
      if (!map.size) continue;
      const line = code.slice(0, lit.index).split('\n').length;
      for (const [alias, table] of map) {
        const cols = SCHEMA.get(table);
        const re = new RegExp(`\\b${alias}\\.([a-z_][a-z0-9_]*)`, 'gi');
        let m;
        while ((m = re.exec(sql))) {
          const col = m[1].toLowerCase();
          if (!cols.has(col)) {
            bad.push(`${path.relative(ROOT, file)}:${line} — ${alias}.${col} (${table} has no such column)`);
          }
        }
      }
    }
  }
  assert.deepStrictEqual(bad, [], `SQL names columns that do not exist:\n${bad.join('\n')}`);
});

test('an ORDER BY inside a single-table social subquery names a real column', () => {
  const bad = [];
  for (const file of FILES) {
    const code = fs.readFileSync(file, 'utf8');
    for (const lit of sqlLiterals(code)) {
      const sql = stripSqlComments(lit.body);
      const line = code.slice(0, lit.index).split('\n').length;
      for (const { table, column } of bareOrderBys(sql)) {
        if (!SCHEMA.get(table).has(column)) {
          bad.push(`${path.relative(ROOT, file)}:${line} — ORDER BY ${column} over ${table}`);
        }
      }
    }
  }
  assert.deepStrictEqual(bad, [], `an ORDER BY names a column that does not exist:\n${bad.join('\n')}`);
});

test("the report's own query is the one that regressed, so assert it directly", () => {
  const code = fs.readFileSync(path.join(SRC, 'services', 'socialReport.js'), 'utf8');
  assert.doesNotMatch(code, /captured_at/, 'captured_at is not a column on any social table');
  assert.match(code, /ORDER BY fetched_at DESC/, 'the latest engagement snapshot is the one with the newest fetched_at');
  assert.doesNotMatch(code, /e\.engagement_rate/, 'the rate is computed in totals(), not selected');
});
