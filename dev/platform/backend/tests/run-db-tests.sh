#!/usr/bin/env bash
# Every .db test, in one command, with a summary.
#
# These are the tests CI cannot run: they need a real Postgres, so they are
# deliberately out of the platform-checks list. The cost of that is rot. On
# 31 October three of them could not insert their own fixtures — clients.slug,
# users.password_hash and social_batches.client_id had each become NOT NULL
# since the fixture was written — and nobody had noticed, so the client asset
# library, the PHP audit and the design routes were running unguarded.
#
# Run this after a migration that adds a NOT NULL column, and before trusting
# any claim that a .db test protects something.
#
#   DB_HOST=/tmp DB_PORT=55434 DB_USER=postgres DB_NAME=omi bash tests/run-db-tests.sh
#
# One wrinkle worth knowing, because it cost a wrong "fix" once. Most of these
# run against the shared development database. design-routes stands up its own
# minimal schema instead, where `clients` is two columns, so it needs a scratch
# database and fails loudly against the shared one. Making its fixture match
# the product's NOT NULL slug is the wrong repair: it then breaks on the
# database it is actually for. This script gives it a scratch database and
# drops it afterwards.
set -u
cd "$(dirname "$0")/.."

# Tests that build their own schema and therefore need an empty database.
SCRATCH="design-routes"

pass=0; fail=0; failed=()
for f in tests/*.db.test.js; do
  name=$(basename "$f" .db.test.js)
  printf '%-24s ' "$name"
  if [[ " $SCRATCH " == *" $name "* ]]; then
    db="dbtest_${name//-/_}_$$"
    if ! createdb "$db" 2>/dev/null; then
      echo "SKIP (could not create the scratch database $db)"
      continue
    fi
    out=$(DB_NAME="$db" node "$f" 2>&1); rc=$?
    dropdb --if-exists "$db" 2>/dev/null
  else
    out=$(node "$f" 2>&1); rc=$?
  fi
  if [ "$rc" -eq 0 ]; then
    echo "ok"; pass=$((pass + 1))
  else
    echo "FAIL"
    echo "$out" | grep -E 'FAIL|Error|error:|needs a database' | head -3 | sed 's/^/    /'
    fail=$((fail + 1)); failed+=("$name")
  fi
done
echo
echo "$pass passed, $fail failed"
[ "$fail" -gt 0 ] && echo "failed: ${failed[*]}"
exit "$fail"
