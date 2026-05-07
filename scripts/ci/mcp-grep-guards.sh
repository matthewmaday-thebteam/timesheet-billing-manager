#!/usr/bin/env bash
# =============================================================================
# mcp-grep-guards.sh
#
# Eight grep-based invariants that must hold across the Manifest MCP slice.
# Any non-zero hit fails CI. Run from the repo root:
#
#   bash scripts/ci/mcp-grep-guards.sh
#
# Each guard is wrapped in `assert_zero_hits` which prints the offending lines
# (so the failure is self-debugging) and increments FAILURES.
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

MCP_TS="supabase/functions/manifest-mcp"
ADMIN_TS="supabase/functions/admin-api-keys"
MIGRATIONS_RANGE="supabase/migrations/10[3-7]_*.sql"

FAILURES=0

# -----------------------------------------------------------------------------
# Helper
# -----------------------------------------------------------------------------
# Usage: assert_zero_hits <label> <command...>
# Runs the command; if any output is produced, the guard fails.
assert_zero_hits() {
    local label="$1"
    shift
    local hits
    # We capture stdout. grep with -r returns 1 on no matches, 0 on matches.
    if hits="$("$@" 2>/dev/null)"; then
        :
    fi
    if [ -n "${hits:-}" ]; then
        echo "FAIL  ${label}"
        echo "${hits}" | sed 's/^/      /'
        FAILURES=$((FAILURES + 1))
    else
        echo "PASS  ${label}"
    fi
}

echo "Manifest MCP CI grep guards"
echo "==========================="

# -----------------------------------------------------------------------------
# Guard 1: financial / capacity columns must not appear in MCP source (.ts)
# -----------------------------------------------------------------------------
# Scope: TypeScript files inside the manifest-mcp Edge Function.
#
# `expected_hours` is part of the locked verify_employee_week contract — it is
# accepted from the caller and threaded through tools.ts/types.ts as a
# parameter NAME. The companion guard (the "Bonus" guard at the bottom of
# this script) prohibits it being read from public.resources inside the
# Postgres function, which is the actual leakage risk. So Guard 1 forbids
# the three pure-financial column names; the caller-supplied parameter
# `expected_hours` is allowed.
assert_zero_hits \
    "1. No financial/capacity field names in manifest-mcp/*.ts" \
    grep -rEn '\b(monthly_cost|hourly_rate|billing_mode)\b' \
        --include='*.ts' "${MCP_TS}"

# -----------------------------------------------------------------------------
# Guard 2: manual_origin must not appear outside views (i.e. anywhere in MCP
# Edge Function source or in non-view portions of migrations 103-107)
# -----------------------------------------------------------------------------
assert_zero_hits \
    "2a. No manual_origin in manifest-mcp/*.ts" \
    grep -rEn '\bmanual_origin\b' --include='*.ts' "${MCP_TS}"

assert_zero_hits \
    "2b. No manual_origin in admin-api-keys/*.ts" \
    grep -rEn '\bmanual_origin\b' --include='*.ts' "${ADMIN_TS}"

# manual_origin in migrations 103-107: only allowed inside CREATE VIEW blocks.
# We approximate by requiring zero hits in the migration files period (we do
# NOT reference manual_origin in any of the views we ship).
assert_zero_hits \
    "2c. No manual_origin in 103-107 migrations" \
    bash -c "grep -EHn '\bmanual_origin\b' ${MIGRATIONS_RANGE} 2>/dev/null || true"

# -----------------------------------------------------------------------------
# Guard 3: bamboo_* source ids must not appear in MCP Edge Function code
# -----------------------------------------------------------------------------
assert_zero_hits \
    "3. No bamboo_request_id|bamboo_employee_id in manifest-mcp/*.ts" \
    grep -rEn '\b(bamboo_request_id|bamboo_employee_id)\b' \
        --include='*.ts' "${MCP_TS}"

# -----------------------------------------------------------------------------
# Guard 4: no SELECT * (case-insensitive) in any 103-107 migration or in MCP
# Edge Function SQL strings.
# -----------------------------------------------------------------------------
assert_zero_hits \
    "4a. No SELECT * in 103-107 migrations" \
    bash -c "grep -EHni 'select[[:space:]]+\\*' ${MIGRATIONS_RANGE} 2>/dev/null || true"

assert_zero_hits \
    "4b. No SELECT * in manifest-mcp/*.ts" \
    grep -rEni 'select[[:space:]]+\*' --include='*.ts' "${MCP_TS}"

# -----------------------------------------------------------------------------
# Guard 5: 103-107 must not modify public.* schema objects
# -----------------------------------------------------------------------------
assert_zero_hits \
    "5. No public.* modifications in 103-107 migrations" \
    bash -c "grep -EHn 'CREATE TABLE public\\.|ALTER TABLE public\\.|CREATE TRIGGER.*ON public\\.|CREATE INDEX.*ON public\\.|CREATE POLICY .* ON public\\.' ${MIGRATIONS_RANGE} 2>/dev/null || true"

# -----------------------------------------------------------------------------
# Guard 6: manifest-mcp/*.ts must NOT reference SUPABASE_SERVICE_ROLE_KEY or
# the literal "service_role".
# -----------------------------------------------------------------------------
assert_zero_hits \
    "6. No service-role references in manifest-mcp/*.ts" \
    grep -rEn '(SUPABASE_SERVICE_ROLE_KEY|service_role)' \
        --include='*.ts' "${MCP_TS}"

# -----------------------------------------------------------------------------
# Guard 7: every CREATE FUNCTION mcp_api.api_* must declare BOTH
#   SET search_path = mcp_api, pg_temp
#   SECURITY DEFINER
# -----------------------------------------------------------------------------
# We do this with a small awk script that streams the relevant migrations,
# remembers each function header, and asserts the two clauses appear before
# the next CREATE FUNCTION begins.
guard_search_path_and_definer() {
    local f
    local awk_out
    awk_out="$(awk '
        BEGIN { in_func = 0; name = ""; saw_def = 0; saw_sp = 0 }
        /^[[:space:]]*CREATE OR REPLACE FUNCTION mcp_api\.api_/ {
            if (in_func == 1 && (saw_def == 0 || saw_sp == 0)) {
                printf("%s:%d  function %s missing %s%s\n",
                    FILENAME, header_line, name,
                    (saw_def == 0 ? "SECURITY DEFINER " : ""),
                    (saw_sp == 0 ? "search_path" : ""))
            }
            in_func = 1; saw_def = 0; saw_sp = 0
            header_line = NR
            name = $0
            next
        }
        /^[[:space:]]*CREATE OR REPLACE FUNCTION / && in_func == 1 {
            # encountered a non-api_* function before the api_* one closed —
            # check the previous one
            if (saw_def == 0 || saw_sp == 0) {
                printf("%s:%d  function %s missing %s%s\n",
                    FILENAME, header_line, name,
                    (saw_def == 0 ? "SECURITY DEFINER " : ""),
                    (saw_sp == 0 ? "search_path" : ""))
            }
            in_func = 0; saw_def = 0; saw_sp = 0
        }
        in_func == 1 && /SECURITY DEFINER/        { saw_def = 1 }
        in_func == 1 && /SET[[:space:]]+search_path[[:space:]]*=[[:space:]]*mcp_api[[:space:]]*,[[:space:]]*pg_temp/ {
            saw_sp = 1
        }
        in_func == 1 && /^\$\$;$/ {
            if (saw_def == 0 || saw_sp == 0) {
                printf("%s:%d  function %s missing %s%s\n",
                    FILENAME, header_line, name,
                    (saw_def == 0 ? "SECURITY DEFINER " : ""),
                    (saw_sp == 0 ? "search_path" : ""))
            }
            in_func = 0; saw_def = 0; saw_sp = 0
        }
        END {
            if (in_func == 1 && (saw_def == 0 || saw_sp == 0)) {
                printf("%s:%d  function %s missing %s%s\n",
                    FILENAME, header_line, name,
                    (saw_def == 0 ? "SECURITY DEFINER " : ""),
                    (saw_sp == 0 ? "search_path" : ""))
            }
        }
    ' supabase/migrations/106_create_api_functions.sql 2>/dev/null || true)"
    echo "${awk_out}"
}

assert_zero_hits \
    "7. Every mcp_api.api_* function declares SECURITY DEFINER + search_path" \
    guard_search_path_and_definer

# -----------------------------------------------------------------------------
# Guard 8: all public.* references in 103-107 must appear inside CREATE VIEW
# blocks only (no public.* reads in views, ad-hoc DDL, or function bodies
# that mutate state — the only legitimate public.* references are the SELECT
# inside the v_api_* views).
# -----------------------------------------------------------------------------
# Strategy: stream each migration, track whether we're inside a CREATE VIEW
# (terminated by the trailing semicolon following the view body). Any
# `public.<ident>` token outside that window is a violation.
guard_public_only_in_views() {
    awk '
        function is_view_open(line) {
            return line ~ /^[[:space:]]*CREATE OR REPLACE VIEW mcp_api\.v_api_/
        }
        BEGIN { in_view = 0 }
        {
            if (in_view == 0 && is_view_open($0)) {
                in_view = 1
                next
            }
            if (in_view == 1) {
                # views terminate at the first semicolon at end-of-line that
                # is NOT inside a comment. Approximate: any line ending in `;`.
                if ($0 ~ /;[[:space:]]*$/) { in_view = 0 }
                next
            }
            # outside a view; flag any public.<ident> reference.
            if ($0 ~ /\bpublic\.[A-Za-z_]/ ) {
                # allow unschedule/cron/cron.job references explicitly - none of
                # those use the public. prefix anyway.
                # also allow comments (lines whose first non-space chars are --).
                stripped = $0
                sub(/^[[:space:]]+/, "", stripped)
                if (stripped !~ /^--/) {
                    printf("%s:%d  public.* reference outside CREATE VIEW: %s\n",
                        FILENAME, NR, $0)
                }
            }
        }
    ' supabase/migrations/103_create_mcp_api_schema.sql \
       supabase/migrations/104_create_api_keys_audit_rate_limit.sql \
       supabase/migrations/105_create_api_views.sql \
       supabase/migrations/106_create_api_functions.sql \
       supabase/migrations/107_create_admin_rpcs_and_cron.sql 2>/dev/null || true
}

assert_zero_hits \
    "8. public.* references in 103-107 only inside CREATE VIEW" \
    guard_public_only_in_views

# -----------------------------------------------------------------------------
# Bonus: the verify_employee_week tool MUST NOT reference public.resources or
# resources.expected_hours (Condition 12).
# -----------------------------------------------------------------------------
guard_verify_no_resources() {
    awk '
        BEGIN { in_func = 0 }
        /^[[:space:]]*CREATE OR REPLACE FUNCTION mcp_api\.api_verify_employee_week\b/ {
            in_func = 1; line0 = NR; next
        }
        in_func == 1 && /^\$\$;$/ { in_func = 0 }
        in_func == 1 && /\b(public\.resources|resources\.expected_hours|FROM[[:space:]]+resources)\b/ {
            printf("%s:%d  forbidden reference inside api_verify_employee_week: %s\n",
                FILENAME, NR, $0)
        }
    ' supabase/migrations/106_create_api_functions.sql 2>/dev/null || true
}

assert_zero_hits \
    "Bonus. api_verify_employee_week has zero references to public.resources / expected_hours" \
    guard_verify_no_resources

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo
if [ "$FAILURES" -eq 0 ]; then
    echo "All MCP grep guards passed."
    exit 0
else
    echo "$FAILURES grep guard(s) FAILED."
    exit 1
fi
