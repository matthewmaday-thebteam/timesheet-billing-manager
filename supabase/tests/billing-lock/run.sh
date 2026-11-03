#!/usr/bin/env bash
# =============================================================================
# Billing-lock test runner (migrations 134-140). LOCAL THROWAWAY DATABASES ONLY.
# =============================================================================
# Usage:
#   PGHOST=localhost PGPORT=55432 PGUSER=postgres \
#   SCHEMA_TEMPLATE=bl_schema [SNAPSHOT_TEMPLATE=bl_snapshot] \
#   supabase/tests/billing-lock/run.sh [test-file-glob]
#
#   SCHEMA_TEMPLATE    database holding the prod schema (no data) + stubs.sql.
#   SNAPSHOT_TEMPLATE  optional: same, plus a read-only extract of the prod
#                      billing tables; enables the s*.sql verification tests.
#   Build both with build-template.sh. Refuses to run against a non-local host.
#
# Steps: (1) idempotency + rollback round-trip, (2) every t*.sql in its own
# database cloned from a migrated synthetic template, (3) s*.sql against the
# snapshot. Exit status is non-zero if anything fails.
# =============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIGRATIONS=("$ROOT"/migrations/13[4-9]_*.sql "$ROOT"/migrations/140_*.sql)
ROLLBACKS=("$ROOT"/rollbacks/140_*_rollback.sql "$ROOT"/rollbacks/139_*_rollback.sql
           "$ROOT"/rollbacks/138_*_rollback.sql "$ROOT"/rollbacks/137_*_rollback.sql
           "$ROOT"/rollbacks/136_*_rollback.sql "$ROOT"/rollbacks/135_*_rollback.sql
           "$ROOT"/rollbacks/134_*_rollback.sql)
SCHEMA_TEMPLATE="${SCHEMA_TEMPLATE:-bl_schema}"
SNAPSHOT_TEMPLATE="${SNAPSHOT_TEMPLATE:-}"
FILTER="${1:-}"

case "${PGHOST:-}" in
  localhost|127.0.0.1|/*) ;;
  *) echo "Refusing to run: PGHOST must be a local throwaway server (got '${PGHOST:-unset}')" >&2; exit 2 ;;
esac

WORK="$(mktemp -d)"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
PASS=0; FAIL=0; FAILED=()

say() { printf '%s\n' "$*"; }
fresh_db() { dropdb --if-exists "$1" >/dev/null 2>&1; createdb -T "$2" "$1"; }
apply_files() { local db=$1 f; shift; for f in "$@"; do "${PSQL[@]}" -d "$db" -f "$f" 2>&1 | grep -E 'ERROR|FATAL' && return 1; done; return 0; }
seed_base() {
  "${PSQL[@]}" -d "$1" -c "INSERT INTO cron.job (jobname, schedule, command) VALUES ('generate-eom-reports', '0 6 1 * *', 'select ''eom-command-sentinel''') ON CONFLICT (jobname) DO NOTHING" >/dev/null &&
  "${PSQL[@]}" -d "$1" -f "$HERE/fixtures/base.sql" >/dev/null
}
record() { if [ "$1" -eq 0 ]; then PASS=$((PASS+1)); say "PASS  $2"; else FAIL=$((FAIL+1)); FAILED+=("$2"); say "FAIL  $2"; fi; }
run_test() {
  local db=$1 file=$2 out
  out=$("${PSQL[@]}" -d "$db" -f "$file" 2>&1); local rc=$?
  local n; n=$(grep -c 'ok - ' <<<"$out")
  if [ $rc -ne 0 ]; then say "$out" | grep -E 'FAIL|ERROR|CONTEXT' | head -8; fi
  record $rc "$(basename "$file") ($n assertions)"
}

# --- (1) idempotency + rollback round-trip ----------------------------------
fresh_db bl_rt "$SCHEMA_TEMPLATE" && seed_base bl_rt
pg_dump -s -d bl_rt > "$WORK"/bl_rt_before.sql
apply_files bl_rt "${MIGRATIONS[@]}"; record $? "migrations 134-140 apply"
apply_files bl_rt "${MIGRATIONS[@]}"; record $? "migrations 134-140 re-apply (idempotent)"
"${PSQL[@]}" -d bl_rt -Atc "SELECT jobname||' '||schedule||' '||command FROM cron.job ORDER BY jobname" > "$WORK"/bl_rt_cron_after.txt
grep -q "^generate-eom-reports 15 6 1 \* \* select 'eom-command-sentinel'$" "$WORK"/bl_rt_cron_after.txt; record $? "140: eom cron rescheduled, command preserved"
grep -q "^reconcile-billing-months 20 4 \* \* \* SELECT public.run_scheduled_billing_reconcile();$" "$WORK"/bl_rt_cron_after.txt; record $? "140: reconcile cron scheduled"
apply_files bl_rt "${ROLLBACKS[@]}"; record $? "rollbacks 140-134 apply"
pg_dump -s -d bl_rt > "$WORK"/bl_rt_after.sql
diff -u <(grep -Ev '^\\(un)?restrict ' "$WORK"/bl_rt_before.sql) <(grep -Ev '^\\(un)?restrict ' "$WORK"/bl_rt_after.sql) > "$WORK"/bl_rt_schema.diff || head -40 "$WORK"/bl_rt_schema.diff
[ ! -s "$WORK"/bl_rt_schema.diff ]; record $? "rollback restores the exact pre-migration schema (pg_dump -s diff empty)"
"${PSQL[@]}" -d bl_rt -Atc "SELECT schedule FROM cron.job WHERE jobname='generate-eom-reports'" | grep -qx '0 6 1 \* \*'; record $? "rollback restores eom cron schedule"
dropdb bl_rt

# --- (2) synthetic tests ------------------------------------------------------
fresh_db bl_migrated "$SCHEMA_TEMPLATE" && seed_base bl_migrated && apply_files bl_migrated "${MIGRATIONS[@]}"
for f in "$HERE"/t$FILTER*.sql; do
  [[ "$(basename "$f")" =~ ^t[0-9] ]] || continue
  fresh_db bl_case bl_migrated
  run_test bl_case "$f"
  dropdb bl_case
done
dropdb bl_migrated

# --- (3) snapshot verification ---------------------------------------------
if [ -n "$SNAPSHOT_TEMPLATE" ]; then
  for f in "$HERE"/s$FILTER*.sql; do
    [[ "$(basename "$f")" =~ ^s[0-9] ]] || continue
    fresh_db bl_snap "$SNAPSHOT_TEMPLATE"
    "${PSQL[@]}" -d bl_snap -c "INSERT INTO cron.job (jobname, schedule, command) VALUES ('generate-eom-reports', '0 6 1 * *', 'select 1') ON CONFLICT (jobname) DO NOTHING" >/dev/null
    "${PSQL[@]}" -d bl_snap -f "$HERE/lib/assert.sql" >/dev/null
    "${PSQL[@]}" -d bl_snap -f "$HERE/snapshot/capture_before.sql" >/dev/null
    if apply_files bl_snap "${MIGRATIONS[@]}"; then run_test bl_snap "$f"; else record 1 "$(basename "$f") (migrations failed on snapshot)"; fi
    dropdb bl_snap
  done
else
  say "SKIP  s*.sql (SNAPSHOT_TEMPLATE not set)"
fi

say "----"
say "passed: $PASS  failed: $FAIL"
[ "$FAIL" -eq 0 ] || { printf '  - %s\n' "${FAILED[@]}"; exit 1; }
