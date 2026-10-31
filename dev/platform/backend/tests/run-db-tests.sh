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
set -u
cd "$(dirname "$0")/.."
pass=0; fail=0; failed=()
for f in tests/*.db.test.js; do
  name=$(basename "$f" .db.test.js)
  printf '%-24s ' "$name"
  if out=$(node "$f" 2>&1); then
    echo "ok"; pass=$((pass + 1))
  else
    echo "FAIL"
    echo "$out" | grep -E 'FAIL|Error|error:' | head -3 | sed 's/^/    /'
    fail=$((fail + 1)); failed+=("$name")
  fi
done
echo
echo "$pass passed, $fail failed"
[ "$fail" -gt 0 ] && echo "failed: ${failed[*]}"
exit "$fail"
