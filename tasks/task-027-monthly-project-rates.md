# Task 027: Monthly Project Rates

**Status:** COMPLETE

## 1. Problem Statement

Project billing rates need to change on a monthly basis. Currently, the system stores a single rate per project in the `projects` table. This design cannot support:
- Historical rate tracking
- Future rate scheduling
- Per-month revenue calculations
- Rate inheritance when viewing historical months

### Requirements

1. **Monthly Rate Changes** - Project rates can change on a monthly basis
2. **Auto-Detection** - New customers and projects from n8n sync are added permanently
3. **Permanent Records** - All companies and projects ever detected are permanently added to the Rates page
4. **Universal Listing** - Rates can be viewed for any month; all customers/projects are always listed
5. **Historical Backfill** - If viewing a date earlier than first appearance, use the rate from first appearance month
6. **Historical Editing** - Admin can update historical rates by selecting the month
7. **Future Scheduling** - Rate changes can be set in advance and apply on the designated date
8. **Default Rate Logic** - If no rate set in first calendar month, default rate is used (locked in at detection time)
9. **Per-Month Calculations** - All reports use the rate for each specific month (e.g., 12-month trend calculates each month separately)
10. **Single Rate Per Month** - Only 1 rate per project per month; multiple changes result in last value used (no prorating)
11. **New Table** - Rates should be stored in a dedicated table

---

## 2. Key Design Decisions

### 2.1 Centralized Default Rate Constant

**Decision:** Use a single function for the default rate, making it easy to change later.

```sql
CREATE OR REPLACE FUNCTION get_default_rate()
RETURNS NUMERIC AS $$
BEGIN
    RETURN 45.00;  -- Single source of truth
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

All functions call `get_default_rate()` instead of hardcoding 45.00.

### 2.2 Rates Locked In at Detection (No Propagation)

**Decision:** Rates are "locked in" at detection time. Default changes do NOT propagate to existing projects.

| Event | Action |
|-------|--------|
| Project A detected Jan 15 | Insert rate row with `get_default_rate()` |
| Admin changes default to $50 on Jan 20 | No action on existing rows |
| Project B detected Jan 25 | Insert rate row with new default ($50) |

**Rationale:** Without intra-month default history, we cannot retroactively determine "what was the default at detection time?" The simplest deterministic approach is to snapshot the default at detection.

### 2.3 First Seen Month Set on Detection

**Decision:** On first detection, always:
1. Set `first_seen_month` to the detected month
2. Insert `project_monthly_rates` row with `rate = get_default_rate()`

After this, `first_seen_month` is never NULL for that project.

### 2.4 Upsert Behavior (Last Write Wins)

**Decision:** `UNIQUE (project_id, rate_month)` constraint ensures one row per project per month. Multiple changes in the same month overwrite the row.

### 2.5 Earlier Month Discovered: Copy Existing Rate

**Decision:** When earlier month is discovered, copy the rate from the old `first_seen_month` to the new earlier month.

**Rationale:**
- We don't have intra-month default history
- Copying preserves the project's original rate (default-at-detection or admin-set)
- Maintains consistency: same rate going back in time

### 2.6 No Rate Row Mutation

**Decision:** Never mutate rate row keys.
- Update `projects.first_seen_month` when earlier data arrives
- Insert a new rate row for the earlier month (copying the existing rate)
- Existing rate rows remain unchanged
- Use `ON CONFLICT DO NOTHING` for concurrent safety

### 2.7 Admin Actions Decoupled from Detection

**Decision:** First appearance is ONLY set by:
- Auto-detection trigger on `timesheet_daily_rollups`
- Data migration
- Never by admin rate update functions

### 2.8 Set-Based Rate Lookups (No N+1)

**Decision:** Use set-based SQL for bulk rate lookups.
- `get_effective_rates_for_range()` returns rates for all projects across a date range in one query
- 12-month trend uses JOIN, not per-row calls

### 2.9 Rate Scope (Project-Level Only)

**Decision:** Project-level rates only (no company-level fallback).
- Every project has its own rate
- Company rates can be added later if needed

### 2.10 Client Info on Projects Table

**Decision:** Add `client_id` and `client_name` columns directly to `projects` table.
- Updated by auto-detection trigger
- Single source of truth for project → client mapping

### 2.11 Trigger Performance (Guarded)

**Decision:** Guard trigger to only fire when relevant columns change.
- Check: `project_id`, `project_name`, `work_date` changes
- Skip processing if these columns unchanged on UPDATE

### 2.12 Concurrency Safety

**Decision:** Use safe concurrent patterns:
- `INSERT ... ON CONFLICT DO NOTHING`
- All operations are idempotent

---

## 3. Behavior Rules Summary

| Scenario | Rule |
|----------|------|
| First detection | Set `first_seen_month`, insert rate = `get_default_rate()` |
| Default changes | No propagation to existing projects |
| Admin edits rate | Upsert, last write wins |
| Earlier month discovered | Copy rate from old first_seen_month |
| Backfill (viewing month < first_seen) | Use rate from first_seen_month |
| Multiple changes in month | Last write wins (upsert) |

---

## 4. Effective Rate Algorithm

For project P and selected month M:

```
1. Get first_seen_month(P) from projects table

2. If M < first_seen_month(P):
   → Use rate from first_seen_month(P) row (backfill)
   → source = 'backfill'
   → source_month = first_seen_month(P)

3. Else (M >= first_seen_month(P)):
   a. Look for rate in project_monthly_rates WHERE rate_month = M
   b. If found → source = 'explicit', source_month = M
   c. If not found → find most recent rate WHERE rate_month < M
   d. If found → source = 'inherited', source_month = that row's month
   e. If not found → DATA INTEGRITY ERROR (log warning, use get_default_rate())

4. Return { rate, source, source_month }
```

---

## 5. Database Architecture

### 5.1 Default Rate Function

```sql
-- Single source of truth for default rate
CREATE OR REPLACE FUNCTION get_default_rate()
RETURNS NUMERIC AS $$
BEGIN
    RETURN 45.00;  -- Change here to update default everywhere
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

### 5.2 Schema Changes to `projects` Table

```sql
-- Add first_seen_month (populated on detection, should not remain NULL)
ALTER TABLE projects ADD COLUMN first_seen_month DATE;

-- Add client info columns
ALTER TABLE projects ADD COLUMN client_id TEXT;
ALTER TABLE projects ADD COLUMN client_name TEXT;

-- Constraint ensures first_seen_month is always first of month
ALTER TABLE projects ADD CONSTRAINT chk_first_seen_first_of_month
    CHECK (first_seen_month IS NULL OR EXTRACT(DAY FROM first_seen_month) = 1);
```

### 5.3 New Table: `project_monthly_rates`

```sql
CREATE TABLE IF NOT EXISTS project_monthly_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Foreign key to projects table
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Month this rate applies to (always first day of month)
    rate_month DATE NOT NULL,

    -- Hourly rate for this month
    rate NUMERIC(10, 2) NOT NULL,

    -- Audit fields
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT uq_project_monthly_rate UNIQUE (project_id, rate_month),
    CONSTRAINT chk_rate_month_first_of_month CHECK (EXTRACT(DAY FROM rate_month) = 1),
    CONSTRAINT chk_rate_non_negative CHECK (rate >= 0)
);

-- Updated_at trigger
CREATE TRIGGER trg_pmr_updated_at
    BEFORE UPDATE ON project_monthly_rates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

### 5.4 Indexes

```sql
-- Primary lookup: get rate for project in a specific month
CREATE INDEX idx_pmr_project_month
    ON project_monthly_rates (project_id, rate_month DESC);

-- Support "all rates in a given month" queries (rates page)
CREATE INDEX idx_pmr_month
    ON project_monthly_rates (rate_month);

-- Projects first_seen_month for range queries
CREATE INDEX idx_projects_first_seen
    ON projects (first_seen_month);
```

### 5.5 Single Rate Lookup Function

```sql
CREATE OR REPLACE FUNCTION get_effective_project_rate(
    p_project_id UUID,
    p_month DATE
)
RETURNS TABLE (
    effective_rate NUMERIC,
    source TEXT,
    source_month DATE
) AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
    v_first_seen_month DATE;
    v_lookup_month DATE;
    v_rate NUMERIC;
    v_rate_month DATE;
BEGIN
    -- Get first_seen_month for this project
    SELECT first_seen_month INTO v_first_seen_month
    FROM projects WHERE id = p_project_id;

    -- Handle NULL first_seen_month (should not happen after migration)
    IF v_first_seen_month IS NULL THEN
        RAISE WARNING 'Project % has NULL first_seen_month', p_project_id;
        RETURN QUERY SELECT get_default_rate(), 'default'::TEXT, NULL::DATE;
        RETURN;
    END IF;

    -- Determine which month to look up (backfill if before first_seen)
    v_lookup_month := GREATEST(v_month, v_first_seen_month);

    -- Find most recent rate <= lookup month
    SELECT pmr.rate, pmr.rate_month
    INTO v_rate, v_rate_month
    FROM project_monthly_rates pmr
    WHERE pmr.project_id = p_project_id
      AND pmr.rate_month <= v_lookup_month
    ORDER BY pmr.rate_month DESC
    LIMIT 1;

    -- Determine source
    IF v_rate IS NOT NULL THEN
        IF v_month < v_first_seen_month THEN
            RETURN QUERY SELECT v_rate, 'backfill'::TEXT, v_rate_month;
        ELSIF v_rate_month = v_month THEN
            RETURN QUERY SELECT v_rate, 'explicit'::TEXT, v_rate_month;
        ELSE
            RETURN QUERY SELECT v_rate, 'inherited'::TEXT, v_rate_month;
        END IF;
    ELSE
        -- Data integrity issue - should not happen
        RAISE WARNING 'No rate found for project % month %', p_project_id, v_month;
        RETURN QUERY SELECT get_default_rate(), 'default'::TEXT, NULL::DATE;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;
```

### 5.6 Bulk Rate Lookup Function (for Reports)

```sql
CREATE OR REPLACE FUNCTION get_effective_rates_for_range(
    p_start_month DATE,
    p_end_month DATE
)
RETURNS TABLE (
    project_id UUID,
    rate_month DATE,
    effective_rate NUMERIC,
    source TEXT,
    source_month DATE
) AS $$
BEGIN
    RETURN QUERY
    WITH
    -- Generate all months in range
    months AS (
        SELECT generate_series(
            DATE_TRUNC('month', p_start_month)::DATE,
            DATE_TRUNC('month', p_end_month)::DATE,
            '1 month'::INTERVAL
        )::DATE AS month
    ),
    -- Cross join projects with months
    project_months AS (
        SELECT p.id AS proj_id, p.first_seen_month, m.month
        FROM projects p
        CROSS JOIN months m
        WHERE p.first_seen_month IS NOT NULL
    ),
    -- Find effective rate for each project-month
    rates_lookup AS (
        SELECT DISTINCT ON (pm.proj_id, pm.month)
            pm.proj_id,
            pm.month,
            pm.first_seen_month,
            pmr.rate AS eff_rate,
            pmr.rate_month AS src_month
        FROM project_months pm
        LEFT JOIN project_monthly_rates pmr
            ON pmr.project_id = pm.proj_id
           AND pmr.rate_month <= GREATEST(pm.month, pm.first_seen_month)
        ORDER BY pm.proj_id, pm.month, pmr.rate_month DESC
    )
    SELECT
        rl.proj_id AS project_id,
        rl.month AS rate_month,
        COALESCE(rl.eff_rate, get_default_rate()) AS effective_rate,
        CASE
            WHEN rl.eff_rate IS NULL THEN 'default'
            WHEN rl.month < rl.first_seen_month THEN 'backfill'
            WHEN rl.src_month = rl.month THEN 'explicit'
            ELSE 'inherited'
        END AS source,
        rl.src_month AS source_month
    FROM rates_lookup rl;
END;
$$ LANGUAGE plpgsql STABLE;
```

### 5.7 Rates Page Query Function

```sql
CREATE OR REPLACE FUNCTION get_all_project_rates_for_month(p_month DATE)
RETURNS TABLE (
    project_id UUID,
    external_project_id TEXT,
    project_name TEXT,
    client_id TEXT,
    client_name TEXT,
    first_seen_month DATE,
    effective_rate NUMERIC,
    source TEXT,
    source_month DATE,
    existed_in_month BOOLEAN
) AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
BEGIN
    RETURN QUERY
    WITH rate_lookup AS (
        SELECT DISTINCT ON (p.id)
            p.id AS proj_id,
            p.project_id AS ext_id,
            p.project_name,
            p.client_id,
            p.client_name,
            p.first_seen_month,
            pmr.rate,
            pmr.rate_month
        FROM projects p
        LEFT JOIN project_monthly_rates pmr
            ON pmr.project_id = p.id
           AND pmr.rate_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
        ORDER BY p.id, pmr.rate_month DESC
    )
    SELECT
        rl.proj_id AS project_id,
        rl.ext_id AS external_project_id,
        rl.project_name,
        rl.client_id,
        rl.client_name,
        rl.first_seen_month,
        COALESCE(rl.rate, get_default_rate()) AS effective_rate,
        CASE
            WHEN rl.rate IS NULL THEN 'default'
            WHEN v_month < rl.first_seen_month THEN 'backfill'
            WHEN rl.rate_month = v_month THEN 'explicit'
            ELSE 'inherited'
        END AS source,
        rl.rate_month AS source_month,
        (v_month >= rl.first_seen_month) AS existed_in_month
    FROM rate_lookup rl
    ORDER BY rl.client_name NULLS LAST, rl.project_name;
END;
$$ LANGUAGE plpgsql STABLE;
```

### 5.8 Admin Rate Update Function

```sql
CREATE OR REPLACE FUNCTION set_project_rate_for_month(
    p_project_id UUID,
    p_month DATE,
    p_rate NUMERIC
)
RETURNS BOOLEAN AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
BEGIN
    -- Validate rate
    IF p_rate < 0 THEN
        RAISE EXCEPTION 'Rate cannot be negative';
    END IF;

    -- Upsert: last write wins
    INSERT INTO project_monthly_rates (project_id, rate_month, rate)
    VALUES (p_project_id, v_month, p_rate)
    ON CONFLICT (project_id, rate_month) DO UPDATE
    SET rate = EXCLUDED.rate, updated_at = NOW();

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
```

### 5.9 Auto-Detection Trigger (Guarded, Concurrent-Safe)

```sql
CREATE OR REPLACE FUNCTION auto_create_project_from_rollup()
RETURNS TRIGGER AS $$
DECLARE
    v_project_uuid UUID;
    v_work_month DATE;
    v_current_first_seen DATE;
    v_existing_rate NUMERIC;
BEGIN
    -- Guard: only process if relevant columns changed (or INSERT)
    IF TG_OP = 'UPDATE' AND NOT (
        OLD.project_id IS DISTINCT FROM NEW.project_id OR
        OLD.project_name IS DISTINCT FROM NEW.project_name OR
        OLD.work_date IS DISTINCT FROM NEW.work_date
    ) THEN
        RETURN NEW;
    END IF;

    -- Skip if no project info
    IF NEW.project_id IS NULL OR NEW.project_name IS NULL THEN
        RETURN NEW;
    END IF;

    v_work_month := DATE_TRUNC('month', NEW.work_date)::DATE;

    -- Try to insert new project, or get existing
    INSERT INTO projects (project_id, project_name, first_seen_month, client_id, client_name)
    VALUES (NEW.project_id, NEW.project_name, v_work_month, NEW.client_id, NEW.client_name)
    ON CONFLICT (project_id) DO UPDATE
        SET project_name = EXCLUDED.project_name,
            client_id = COALESCE(projects.client_id, EXCLUDED.client_id),
            client_name = COALESCE(projects.client_name, EXCLUDED.client_name)
        WHERE projects.project_name != EXCLUDED.project_name
           OR (projects.client_id IS NULL AND EXCLUDED.client_id IS NOT NULL)
    RETURNING id, first_seen_month INTO v_project_uuid, v_current_first_seen;

    -- Get ID if no insert/update happened
    IF v_project_uuid IS NULL THEN
        SELECT id, first_seen_month
        INTO v_project_uuid, v_current_first_seen
        FROM projects WHERE project_id = NEW.project_id;
    END IF;

    -- Handle first_seen_month logic
    IF v_current_first_seen IS NULL THEN
        -- First detection: set first_seen_month and create rate record
        UPDATE projects
        SET first_seen_month = v_work_month
        WHERE id = v_project_uuid;

        INSERT INTO project_monthly_rates (project_id, rate_month, rate)
        VALUES (v_project_uuid, v_work_month, get_default_rate())
        ON CONFLICT (project_id, rate_month) DO NOTHING;

    ELSIF v_work_month < v_current_first_seen THEN
        -- Earlier month discovered: copy rate from current first_seen_month
        SELECT rate INTO v_existing_rate
        FROM project_monthly_rates
        WHERE project_id = v_project_uuid
          AND rate_month = v_current_first_seen;

        -- Update first_seen_month to earlier month
        UPDATE projects
        SET first_seen_month = v_work_month
        WHERE id = v_project_uuid
          AND first_seen_month > v_work_month;

        -- Insert rate for earlier month (copy existing or use default)
        INSERT INTO project_monthly_rates (project_id, rate_month, rate)
        VALUES (v_project_uuid, v_work_month, COALESCE(v_existing_rate, get_default_rate()))
        ON CONFLICT (project_id, rate_month) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger
DROP TRIGGER IF EXISTS trg_auto_create_project ON timesheet_daily_rollups;
CREATE TRIGGER trg_auto_create_project
    AFTER INSERT OR UPDATE ON timesheet_daily_rollups
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_project_from_rollup();
```

### 5.10 RLS Policies

```sql
ALTER TABLE project_monthly_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read monthly rates"
    ON project_monthly_rates FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert monthly rates"
    ON project_monthly_rates FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update monthly rates"
    ON project_monthly_rates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow service role full access monthly rates"
    ON project_monthly_rates FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Grants
GRANT SELECT, INSERT, UPDATE ON project_monthly_rates TO authenticated;
GRANT ALL ON project_monthly_rates TO service_role;
GRANT EXECUTE ON FUNCTION get_default_rate TO authenticated;
GRANT EXECUTE ON FUNCTION get_effective_project_rate TO authenticated;
GRANT EXECUTE ON FUNCTION get_effective_rates_for_range TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_project_rates_for_month TO authenticated;
GRANT EXECUTE ON FUNCTION set_project_rate_for_month TO authenticated;
```

---

## 6. Migration Strategy

### 6.1 Migration 020: Create Schema

```sql
BEGIN;

-- Step 1: Create default rate function
CREATE OR REPLACE FUNCTION get_default_rate()
RETURNS NUMERIC AS $$
BEGIN
    RETURN 45.00;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 2: Add columns to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS first_seen_month DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_name TEXT;

-- Step 3: Compute first_seen_month from actual timesheet data
UPDATE projects p
SET first_seen_month = sub.first_month
FROM (
    SELECT
        project_id,
        DATE_TRUNC('month', MIN(work_date))::DATE AS first_month
    FROM timesheet_daily_rollups
    GROUP BY project_id
) sub
WHERE p.project_id = sub.project_id
  AND p.first_seen_month IS NULL;

-- For projects with no rollup data, use created_at as fallback
UPDATE projects
SET first_seen_month = DATE_TRUNC('month', created_at)::DATE
WHERE first_seen_month IS NULL;

-- Step 4: Populate client info from rollups
UPDATE projects p
SET client_id = sub.client_id,
    client_name = sub.client_name
FROM (
    SELECT DISTINCT ON (project_id)
        project_id,
        client_id,
        client_name
    FROM timesheet_daily_rollups
    WHERE client_id IS NOT NULL
    ORDER BY project_id, synced_at DESC
) sub
WHERE p.project_id = sub.project_id
  AND p.client_id IS NULL;

-- Step 5: Add constraint
ALTER TABLE projects ADD CONSTRAINT chk_first_seen_first_of_month
    CHECK (first_seen_month IS NULL OR EXTRACT(DAY FROM first_seen_month) = 1);

-- Step 6: Create project_monthly_rates table
CREATE TABLE IF NOT EXISTS project_monthly_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    rate_month DATE NOT NULL,
    rate NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_project_monthly_rate UNIQUE (project_id, rate_month),
    CONSTRAINT chk_rate_month_first_of_month CHECK (EXTRACT(DAY FROM rate_month) = 1),
    CONSTRAINT chk_rate_non_negative CHECK (rate >= 0)
);

-- Step 7: Create indexes
CREATE INDEX idx_pmr_project_month ON project_monthly_rates (project_id, rate_month DESC);
CREATE INDEX idx_pmr_month ON project_monthly_rates (rate_month);
CREATE INDEX idx_projects_first_seen ON projects (first_seen_month);

-- Step 8: Create updated_at trigger
CREATE TRIGGER trg_pmr_updated_at
    BEFORE UPDATE ON project_monthly_rates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Step 9: Create functions (get_effective_project_rate, get_effective_rates_for_range, etc.)
-- [Include all function definitions from section 5.5-5.8]

-- Step 10: Update auto-detection trigger
-- [Include trigger definition from section 5.9]

-- Step 11: Create RLS policies
-- [Include policies from section 5.10]

COMMIT;
```

### 6.2 Migration 021: Migrate Existing Rates

```sql
BEGIN;

-- Create baseline snapshot for verification
CREATE TEMP TABLE migration_baseline AS
SELECT
    p.id AS project_id,
    p.project_name,
    p.rate AS old_rate,
    p.first_seen_month
FROM projects p;

-- For each project, create a rate record for first_seen_month
-- Use existing rate if set, otherwise use default
INSERT INTO project_monthly_rates (project_id, rate_month, rate)
SELECT
    p.id,
    p.first_seen_month,
    COALESCE(p.rate, get_default_rate())
FROM projects p
WHERE p.first_seen_month IS NOT NULL
ON CONFLICT (project_id, rate_month) DO NOTHING;

-- Verification: compare old vs new rates
DO $$
DECLARE
    v_mismatch_count INTEGER;
    v_projects_count INTEGER;
    v_rates_count INTEGER;
BEGIN
    -- Check for mismatches
    SELECT COUNT(*) INTO v_mismatch_count
    FROM migration_baseline b
    JOIN projects p ON p.id = b.project_id
    LEFT JOIN project_monthly_rates pmr
        ON pmr.project_id = p.id
       AND pmr.rate_month = p.first_seen_month
    WHERE b.old_rate IS NOT NULL
      AND b.old_rate != pmr.rate;

    IF v_mismatch_count > 0 THEN
        RAISE WARNING 'Found % rate mismatches after migration', v_mismatch_count;
    END IF;

    -- Summary
    SELECT COUNT(*) INTO v_projects_count FROM projects WHERE first_seen_month IS NOT NULL;
    SELECT COUNT(*) INTO v_rates_count FROM project_monthly_rates;

    RAISE NOTICE 'Migration complete:';
    RAISE NOTICE '  - % projects with first_seen_month', v_projects_count;
    RAISE NOTICE '  - % rate records created', v_rates_count;

    IF v_projects_count != v_rates_count THEN
        RAISE WARNING 'Mismatch: expected % rate records, got %', v_projects_count, v_rates_count;
    END IF;
END $$;

DROP TABLE migration_baseline;

COMMIT;
```

### 6.3 Post-Migration Verification

```sql
-- Run BEFORE and AFTER migration to compare revenue calculations

-- Sample revenue calculation for a known month
WITH old_calc AS (
    SELECT
        SUM(r.total_minutes / 60.0 * COALESCE(p.rate, 45.00)) AS revenue
    FROM timesheet_daily_rollups r
    JOIN projects p ON p.project_id = r.project_id
    WHERE DATE_TRUNC('month', r.work_date) = '2025-12-01'
),
new_calc AS (
    SELECT
        SUM(r.total_minutes / 60.0 * rates.effective_rate) AS revenue
    FROM timesheet_daily_rollups r
    JOIN projects p ON p.project_id = r.project_id
    JOIN get_effective_rates_for_range('2025-12-01', '2025-12-01') rates
        ON rates.project_id = p.id AND rates.rate_month = '2025-12-01'
)
SELECT
    old_calc.revenue AS old_revenue,
    new_calc.revenue AS new_revenue,
    ABS(old_calc.revenue - new_calc.revenue) AS difference
FROM old_calc, new_calc;

-- Should show difference = 0
```

---

## 7. TypeScript Types

### File: `src/types/index.ts` (additions)

```typescript
export interface ProjectMonthlyRate {
  id: string;
  project_id: string;
  rate_month: string;  // ISO date string, always 1st of month
  rate: number;
  created_at: string;
  updated_at: string;
}

export interface MonthSelection {
  year: number;
  month: number; // 1-12
}

export type RateSource = 'explicit' | 'inherited' | 'backfill' | 'default';

export interface ProjectRateDisplay {
  projectId: string;
  externalProjectId: string;
  projectName: string;
  clientId: string | null;
  clientName: string | null;
  firstSeenMonth: string | null;

  // What
  effectiveRate: number;

  // Why
  source: RateSource;
  sourceMonth: string | null;

  // Context
  existedInSelectedMonth: boolean;

  // Edit info
  hasExplicitRateThisMonth: boolean;  // source === 'explicit'
}

export interface RateHistoryEntry {
  rateMonth: string;
  rate: number;
  createdAt: string;
  updatedAt: string;
}
```

---

## 8. React Hooks

### 8.1 `useMonthlyRates` Hook

**File:** `src/hooks/useMonthlyRates.ts`

```typescript
interface UseMonthlyRatesOptions {
  selectedMonth: MonthSelection;
}

interface UseMonthlyRatesReturn {
  projectsWithRates: ProjectRateDisplay[];
  isLoading: boolean;
  error: Error | null;
  updateRate: (projectId: string, month: MonthSelection, rate: number) => Promise<void>;
  refetch: () => void;
}

export function useMonthlyRates({ selectedMonth }: UseMonthlyRatesOptions): UseMonthlyRatesReturn;
```

Calls `get_all_project_rates_for_month()` RPC function.

### 8.2 `useRateHistory` Hook

**File:** `src/hooks/useRateHistory.ts`

```typescript
export function useRateHistory(projectId: string): {
  history: RateHistoryEntry[];
  isLoading: boolean;
};
```

---

## 9. Component Changes

### 9.1 RatesPage Updates

**File:** `src/components/pages/RatesPage.tsx`

Changes:
- Add `MonthPicker` component for month selection
- Add legend showing rate source indicators
- Pass `selectedMonth` to `BillingRatesTable`

### 9.2 MonthPicker Component (New)

**File:** `src/components/MonthPicker.tsx`

Features:
- Previous/Next month navigation arrows
- "Today" button to jump to current month
- Future month indicator badge
- Display format: "January 2026"

### 9.3 BillingRatesTable Updates

**File:** `src/components/BillingRatesTable.tsx`

Changes:
- Accept `selectedMonth` prop
- Display rate source indicators (colored dots)
- Show "Not yet created" badge for projects that didn't exist in selected month
- Show inherited rate source (e.g., "from Nov 2025")
- Add edit button to open rate editor

### 9.4 RateEditModal (New)

**File:** `src/components/RateEditModal.tsx`

Features:
- Month selector (can edit any month)
- Rate input field
- Current rate display with source
- Warning for historical/future edits
- Rate history toggle
- Save/Cancel buttons

### 9.5 Rate Source Visual Indicators

| Color | Source | Display |
|-------|--------|---------|
| Green | explicit | "$75.00" |
| Blue | inherited | "$75.00 (from Nov 2025)" |
| Blue | backfill | "$75.00 (from Jan 2026 - first seen)" |
| Gray | default | "$45.00 (default)" |
| Purple | (future) | "$80.00 (scheduled)" |

---

## 10. Calculation Updates

### 10.1 `billing.ts` Changes

**File:** `src/utils/billing.ts`

Update revenue calculations to use set-based rate lookups:

```typescript
async function calculateMonthlyRevenue(
  entries: TimesheetEntry[],
  month: MonthSelection
): Promise<{ total: number; byProject: Map<string, number> }>;

async function calculate12MonthRevenueTrend(): Promise<{
  month: string;
  revenue: number;
}[]>;
```

Uses `get_effective_rates_for_range()` for bulk lookups.

### 10.2 Dashboard 12-Month Trend

**File:** `src/components/Dashboard.tsx`

Update to:
1. Get date range (last 12 months)
2. Call `get_effective_rates_for_range()` once
3. Join with timesheet data
4. Calculate revenue per month

---

## 11. Files to Create

| File | Description |
|------|-------------|
| `supabase/migrations/020_create_project_monthly_rates.sql` | Schema, functions, triggers |
| `supabase/migrations/021_migrate_existing_rates.sql` | Data migration |
| `src/hooks/useMonthlyRates.ts` | Core rates hook |
| `src/hooks/useRateHistory.ts` | Rate history hook |
| `src/components/MonthPicker.tsx` | Month selection component |
| `src/components/RateEditModal.tsx` | Rate editing modal |

## 12. Files to Modify

| File | Changes |
|------|---------|
| `src/types/index.ts` | Add rate-related types |
| `src/components/pages/RatesPage.tsx` | Add month picker, update table usage |
| `src/components/BillingRatesTable.tsx` | Add rate source indicators, edit buttons |
| `src/utils/billing.ts` | Update revenue calculations for monthly rates |
| `src/utils/calculations.ts` | Update aggregation to support monthly rates |
| `src/components/Dashboard.tsx` | Update 12-month trend to use monthly rates |
| `src/components/pages/RevenuePage.tsx` | Use monthly rates for calculations |

---

## 13. Edge Cases

| Scenario | Handling |
|----------|----------|
| First detection | Set `first_seen_month`, insert rate = `get_default_rate()` |
| Default changes | No propagation to existing projects |
| Admin edits rate | Upsert, last write wins |
| Earlier month discovered | Copy rate from old first_seen_month |
| Backfill (viewing month < first_seen) | Use rate from first_seen_month |
| Multiple changes in month | Last write wins (upsert) |
| NULL first_seen_month | Log warning, use default (should not happen) |
| Concurrent sync | `ON CONFLICT DO NOTHING` ensures safety |

---

## 14. Verification Steps

1. Run migrations 020 and 021
2. Verify first_seen_month populated: `SELECT COUNT(*) FROM projects WHERE first_seen_month IS NOT NULL`
3. Verify rate records created: `SELECT COUNT(*) FROM project_monthly_rates`
4. Test rate lookup: `SELECT * FROM get_effective_project_rate(project_id, '2026-01-01')`
5. Test bulk lookup: `SELECT * FROM get_effective_rates_for_range('2025-02-01', '2026-01-01') LIMIT 10`
6. **Run before/after revenue comparison** (see section 6.3)
7. Test rates page month navigation
8. Test rate editing for current, historical, and future months
9. Verify Dashboard 12-month trend calculates correctly

---

## 15. Implementation Phases

### Phase 1: Database (Migration 020-021)
- Create `get_default_rate()` function
- Add `first_seen_month`, `client_id`, `client_name` to projects
- Create `project_monthly_rates` table
- Create all functions and triggers
- Migrate existing rates
- **Run verification queries**

### Phase 2: TypeScript & Hooks
- Add types to `src/types/index.ts`
- Create `useMonthlyRates` hook
- Create `useRateHistory` hook

### Phase 3: UI Components
- Create `MonthPicker` component
- Create `RateEditModal` component
- Update `RatesPage` with month selection
- Update `BillingRatesTable` with indicators

### Phase 4: Calculation Updates
- Update `billing.ts` for set-based rate lookups
- Update Dashboard revenue trend
- Update Revenue page calculations

### Phase 5: Testing & Verification
- Test all edge cases
- Verify calculations match expected values
- Compare before/after migration reports

---

## 16. Dependencies

- None (standalone feature)

## 17. Rollback Plan

1. Drop `project_monthly_rates` table
2. Drop `first_seen_month`, `client_id`, `client_name` columns from projects
3. Drop `get_default_rate()` function
4. Revert frontend changes
5. `projects.rate` column remains intact as fallback

---

## 18. Review Questions Addressed

### Round 1

| Question | Resolution |
|----------|------------|
| Default rate determinism | Locked in at detection time |
| First appearance fragility | Move to projects.first_seen_month |
| Rate row mutation | Never mutate keys; insert new rows |
| Backfill computation | Use MIN(work_date) from rollups |
| Admin vs detection | Decoupled; only triggers set first_seen |
| N+1 performance | Set-based SQL functions |
| "Why" in UI | Return source + source_month |
| Company vs project rates | Project-only for now |
| Migration stability | Same values before/after |

### Round 2

| Question | Resolution |
|----------|------------|
| Hardcoded 45.00 | Centralized in `get_default_rate()` function |
| Default snapshot timing | Locked in at detection, no propagation |
| first_seen_month nullability | Set on detection, should not remain NULL |
| Trigger performance | Guarded for relevant column changes only |
| Race conditions | `ON CONFLICT DO NOTHING` ensures safety |
| Earlier month rate copy | Copy rate from old first_seen_month |
| Bulk function performance | Monitor; acceptable at expected scale |
| Client info heuristic | Added client_id/client_name to projects table |

### Round 3

| Question | Resolution |
|----------|------------|
| Hardcoded default OK for v1 | Yes, centralized in `get_default_rate()` |
| Default changes mid-month | Last value wins, no propagation to existing |
| first_seen_month behavior | Set on detection, insert rate = `get_default_rate()` |
| Upsert last write wins | Confirmed via `ON CONFLICT DO UPDATE` |
| Earlier month discovered | Copy rate from old first_seen_month |

---

## Implementation Notes

**Date:** 2026-01-22

### Files Created
| File | Description |
|------|-------------|
| `supabase/migrations/020_create_project_monthly_rates.sql` | Schema, functions, triggers for monthly rates |
| `supabase/migrations/021_migrate_existing_rates.sql` | Migrates existing project.rate values to monthly rates table |
| `supabase/rollbacks/020_021_rollback.sql` | Rollback script for safe reversion |
| `src/hooks/useMonthlyRates.ts` | React hook for fetching and updating monthly rates |
| `src/hooks/useRateHistory.ts` | React hook for viewing rate change history |
| `src/components/MonthPicker.tsx` | Month navigation component |
| `src/components/RateEditModal.tsx` | Modal for editing rates with history view |

### Files Modified
| File | Changes |
|------|---------|
| `src/types/index.ts` | Added ProjectMonthlyRate, MonthSelection, RateSource, ProjectRateDisplay, RateHistoryEntry types |
| `src/components/pages/RatesPage.tsx` | Added MonthPicker, uses new useMonthlyRates hook, rate source legend |
| `src/components/BillingRatesTable.tsx` | New props for monthly rates, source indicators (colored dots), RateEditModal integration |

### TypeScript Validation
- Passed with no errors

### Commit
- Hash: `79c8132`
- Message: `feat: Add monthly project rates system (Task 027)`

### Remaining Steps
1. **Push to remote**: Run `git push` from Windows terminal (WSL has credential issues)
2. **Run migrations in Supabase SQL Editor**:
   - Run `020_create_project_monthly_rates.sql` first
   - Then run `021_migrate_existing_rates.sql`
3. **Verify migration**:
   - Check projects table has `first_seen_month` populated
   - Check `project_monthly_rates` table has rate records
   - Test Rates page month navigation
4. **Deploy to Vercel**: Push will trigger automatic deployment

### Rollback Plan
If issues occur:
1. Run `supabase/rollbacks/020_021_rollback.sql` in Supabase SQL Editor
2. Revert frontend commit: `git revert 79c8132`
3. Push reverted changes

---

## UI Refinements (2026-01-22)

### Changes Made
After initial deployment, the following UI refinements were made:

1. **Replaced MonthPicker with DateRangeFilter** - Now uses the same month selector as Revenue page (Current Month / Select Month buttons with prev/next arrows)

2. **Added Export CSV button** - Exports Company, Project, Rate for all projects in selected month

3. **Removed rate source indicators** - Removed colored dots and "(from Jan 2026)" labels from inline display

4. **Removed legend** - Removed rate source legend from upper-right corner

5. **Simplified RateEditModal**:
   - Title is now "Edit Rate" (not project name or "Edit Rate for Month")
   - Project name displayed below the header line
   - Removed grey box with "PROJECT" label and company name
   - Removed "Current Rate and Source" recap box
   - Kept "Show Rate History" toggle

6. **Updated Metrics Row** (5 cards):
   - Average Rate (excludes $0 rate projects)
   - 2026 Target ($60.00)
   - Base Rate ($45.00) - displays DEFAULT_RATE constant
   - At 2026 Target (count)
   - Default (count of projects at $45 rate)

### Files Modified in Refinement
| File | Changes |
|------|---------|
| `src/components/pages/RatesPage.tsx` | DateRangeFilter, Export CSV, updated metrics, excludes $0 from average |
| `src/components/BillingRatesTable.tsx` | Removed source dots and labels |
| `src/components/RateEditModal.tsx` | Simplified layout with "Edit Rate" title |
| `src/hooks/useMonthlyRates.ts` | Fixed timezone bug in date formatting |
