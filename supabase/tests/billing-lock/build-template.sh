#!/usr/bin/env bash
# =============================================================================
# Build the local template databases used by run.sh. Never writes to prod.
# =============================================================================
#   PGHOST=localhost PGPORT=55432 PGUSER=postgres \
#   supabase/tests/billing-lock/build-template.sh [--snapshot-dir DIR]
#
# 1. Schema: `supabase db dump --linked --dry-run` prints the pg_dump script the
#    CLI would run in Docker (with a short-lived cli_login role). We run that
#    script with the local pg_dump 17 instead (schema only, read-only), strip
#    platform extensions, and load it on top of stubs.sql into `bl_schema`.
# 2. Optional snapshot: with --snapshot-dir DIR (JSON from snapshot/pull.mjs,
#    kept outside the repo) also builds `bl_snapshot` = bl_schema + that data.
# Requires: a running local Postgres 17 server, linked supabase CLI.
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
SNAP_DIR=""
[ "${1:-}" = "--snapshot-dir" ] && SNAP_DIR="$(cd "$2" && pwd)"
case "${PGHOST:-}" in localhost|127.0.0.1|/*) ;; *) echo "PGHOST must be local" >&2; exit 2 ;; esac

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
( cd "$REPO" && supabase db dump --linked --dry-run 2>/dev/null ) > "$WORK/dump.sh"
chmod 600 "$WORK/dump.sh"
bash "$WORK/dump.sh" > "$WORK/schema.sql"
rm -f "$WORK/dump.sh"   # contains a temporary credential
grep -vE 'CREATE EXTENSION IF NOT EXISTS "(pg_cron|pg_net|pg_stat_statements|supabase_vault|pgcrypto|uuid-ossp)"' \
  "$WORK/schema.sql" > "$WORK/schema_local.sql"

dropdb --if-exists bl_schema
createdb bl_schema
psql -X -q -d bl_schema -f "$HERE/stubs.sql" 2>&1 | grep -v wal_level | grep -v HINT || true
psql -X -q -d bl_schema -f "$WORK/schema_local.sql" 2>&1 | grep ERROR && { echo "schema load failed" >&2; exit 1; }
echo "built bl_schema"

if [ -n "$SNAP_DIR" ]; then
  dropdb --if-exists bl_snapshot
  createdb -T bl_schema bl_snapshot
  PGOPTIONS="-c snap.dir=$SNAP_DIR" psql -X -q -v ON_ERROR_STOP=1 -d bl_snapshot -f "$HERE/snapshot/load.sql"
  echo "built bl_snapshot from $SNAP_DIR"
fi
