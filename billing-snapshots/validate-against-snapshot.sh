#!/bin/bash
# ===========================================================================
# Validate current billing calculations against golden reference snapshot
#
# Usage:
#   ./billing-snapshots/validate-against-snapshot.sh
#
# What it does:
#   1. Queries the current project_monthly_summary from Supabase
#   2. Compares every field against the golden reference JSON
#   3. Reports any discrepancies
#
# When to run:
#   - After any migration that touches billing tables/functions
#   - After changing useUnifiedBilling or useSummaryBilling
#   - After switching the frontend to read from the summary table
#   - After any backfill or recalculation
# ===========================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SNAPSHOT="$SCRIPT_DIR/golden-reference-2026-02-10.json"

PROJECT_REF="yptbnsegcfpizwhipeep"
TOKEN="sbp_b2dfdaf1b53bc69335f569f22282a3e6ce354993"
API_URL="https://api.supabase.com/v1/projects/$PROJECT_REF/database/query"

if [ ! -f "$SNAPSHOT" ]; then
  echo "ERROR: Golden reference not found at $SNAPSHOT"
  exit 1
fi

echo "Validating against: $(basename "$SNAPSHOT")"
echo ""

# Query current data for all months
for MONTH in "2026-01-01" "2026-02-01"; do
  MONTH_KEY="${MONTH:0:7}"

  CURRENT=$(curl -s -X POST "$API_URL" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "User-Agent: supabase-cli/2.67.1" \
    -d "$(python3 -c "import json; print(json.dumps({'query': \"SELECT p.project_id AS external_project_id, p.project_name, pms.actual_minutes, pms.rounded_minutes, pms.billed_hours, pms.billed_revenue_cents, pms.milestone_override_cents, pms.base_revenue_cents FROM project_monthly_summary pms JOIN projects p ON p.id = pms.project_id WHERE pms.summary_month = '$MONTH' ORDER BY p.project_id;\"}))")")

  python3 - "$SNAPSHOT" "$MONTH_KEY" "$CURRENT" << 'PYEOF'
import json, sys

snapshot_path = sys.argv[1]
month_key = sys.argv[2]
current_json = sys.argv[3]

with open(snapshot_path) as f:
    snapshot = json.load(f)

current = json.loads(current_json)
expected = snapshot['months'][month_key]['projects']

# Build lookup by external_project_id
expected_by_id = {}
for p in expected:
    expected_by_id[p['external_project_id']] = p

current_by_id = {}
for p in current:
    current_by_id[p['external_project_id']] = p

# Compare
fields = [
    'actual_minutes', 'rounded_minutes', 'billed_hours',
    'billed_revenue_cents', 'base_revenue_cents', 'milestone_override_cents',
]
discrepancies = 0
checked = 0

all_ids = set(list(expected_by_id.keys()) + list(current_by_id.keys()))

for pid in sorted(all_ids):
    exp = expected_by_id.get(pid)
    cur = current_by_id.get(pid)

    if not exp:
        name = cur.get('project_name', pid) if cur else pid
        print(f"  NEW: {name} ({pid}) — not in snapshot")
        discrepancies += 1
        continue
    if not cur:
        print(f"  MISSING: {exp['project_name']} ({pid}) — in snapshot but not in DB")
        discrepancies += 1
        continue

    for field in fields:
        e_val = exp.get(field)
        c_val = cur.get(field)
        # Normalize None
        if e_val is None and c_val is None:
            continue
        # Compare as numbers
        try:
            e_num = float(e_val) if e_val is not None else None
            c_num = float(c_val) if c_val is not None else None
        except (TypeError, ValueError):
            e_num, c_num = e_val, c_val

        if e_num != c_num:
            print(f"  DIFF: {exp['project_name']} / {field}: expected={e_val} got={c_val}")
            discrepancies += 1
        checked += 1

# Totals check
exp_totals = snapshot['months'][month_key]['totals']
cur_timesheet = sum(int(p.get('billed_revenue_cents', 0)) for p in current)
cur_effective = sum(
    int(p['milestone_override_cents']) if p.get('milestone_override_cents') is not None
    else int(p.get('billed_revenue_cents', 0))
    for p in current
)

if cur_timesheet != exp_totals['billed_revenue_cents']:
    print(f"  DIFF TOTAL: timesheet_cents expected={exp_totals['billed_revenue_cents']} got={cur_timesheet}")
    discrepancies += 1
if cur_effective != exp_totals['effective_revenue_cents']:
    print(f"  DIFF TOTAL: effective_cents expected={exp_totals['effective_revenue_cents']} got={cur_effective}")
    discrepancies += 1

if discrepancies == 0:
    print(f"  {month_key}: ALL MATCH ({checked} fields checked, {len(all_ids)} projects)")
else:
    print(f"  {month_key}: {discrepancies} DISCREPANCIES ({checked} fields checked)")

PYEOF
done

echo ""
echo "Done."
