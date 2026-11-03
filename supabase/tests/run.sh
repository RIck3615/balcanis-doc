#!/usr/bin/env bash
# Teste les migrations sur un PostgreSQL local : ./supabase/tests/run.sh "psql -h HOTE -p PORT -U postgres"
set -euo pipefail
PSQL=${1:-"psql -h /tmp/pg -p 5499 -U postgres"}
DIR=$(cd "$(dirname "$0")/.." && pwd)
$PSQL -q -c "drop database if exists balcanis_test" -c "create database balcanis_test"
for f in "$DIR/tests/supabase_stub.sql" "$DIR"/migrations/*.sql; do
  $PSQL -q -v ON_ERROR_STOP=1 -d balcanis_test -f "$f"
done
$PSQL -v ON_ERROR_STOP=1 -d balcanis_test -f "$DIR/tests/scenario.sql"
