# Task 050: SECURITY DEFINER View Audit & Remediation

## Status: Pending
## Priority: High (security)

## Context

Supabase's database linter flagged 18 views in the `public` schema defined with `SECURITY DEFINER`. These views execute with the **creator's** permissions rather than the querying user's, which bypasses Row Level Security (RLS) policies on the underlying tables.

Migration 053 resolved 4 related findings (RLS on legacy tables + anon access to `admin_users_view`). This task covers the remaining 18.

## Affected Views

| # | View | Likely Purpose |
|---|------|---------------|
| 1 | `admin_users_view` | Joins auth.users with user_profiles |
| 2 | `v_timesheet_entries` | Timesheet entry rollup |
| 3 | `v_timesheet_daily_rollups` | Daily hours aggregation |
| 4 | `v_company_canonical` | Canonical company mapping |
| 5 | `v_project_canonical` | Canonical project mapping |
| 6 | `v_entity_canonical` | Canonical entity mapping |
| 7 | `v_group_member_details` | Entity group member details |
| 8 | `v_project_group_member_details` | Project group member details |
| 9 | `v_company_group_member_details` | Company group member details |
| 10 | `v_project_carryover_totals` | Project carryover hour totals |
| 11 | `v_monthly_summary_by_company` | Monthly billing summary by company |
| 12 | `v_monthly_summary_totals` | Monthly billing summary totals |
| 13 | `v_combined_revenue_by_company_month` | Combined revenue aggregation |
| 14 | `v_canonical_project_monthly_summary` | Canonical project monthly billing |
| 15 | `v_project_table_entities` | Project table entity list |
| 16 | `v_employee_table_entities` | Employee table entity list |
| 17 | `v_company_table_entities` | Company table entity list |
| 18 | `v_carryover_chain` | Carryover hour chain calculation |

## Audit Steps (per view)

For each view:

1. **Identify the source migration** — find where the view was created (`CREATE VIEW` or `CREATE OR REPLACE VIEW`)
2. **List underlying tables** — which tables does the view SELECT from?
3. **Check RLS on underlying tables** — are any of those tables RLS-protected?
4. **Check grants** — who currently has SELECT on the view? (`anon`, `authenticated`, `service_role`)
5. **Determine if SECURITY DEFINER is intentional** — does the view need to bypass RLS to function? (e.g., `admin_users_view` reads from `auth.users` which has RLS)
6. **Classify the remediation**:
   - **Safe to convert**: View's underlying tables either have no RLS, or the `authenticated` role has sufficient SELECT permissions. Switch to `SECURITY INVOKER`.
   - **Needs grant changes**: Underlying tables have RLS but the view should be accessible. Add appropriate RLS policies or grants, then switch to `SECURITY INVOKER`.
   - **Intentionally DEFINER**: The view legitimately needs elevated access (e.g., reading `auth.users`). Document the justification and leave as-is.

## Implementation

- Produce a single migration (054) that recreates safe-to-convert views with `security_invoker = true`
- Document any views left as SECURITY DEFINER with justification
- Test by querying each converted view as `authenticated` role and confirming results match pre-migration output

## Acceptance Criteria

- [ ] All 18 views audited and classified
- [ ] Safe views converted to SECURITY INVOKER via migration
- [ ] Intentional DEFINER views documented with justification
- [ ] No regressions — all pages load correctly after migration
- [ ] Supabase linter re-run confirms reduced finding count

## References

- Supabase docs: https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view
- Migration 053: `053_security_rls_and_anon_cleanup.sql` (prerequisite, already applied)
- Migration 010: `010_user_management.sql` (created `admin_users_view`)
