# Timesheet Billing Manager

A React-based timesheet and billing management application that integrates with Clockify for time tracking data.

## Features

- **Dashboard**: Overview of timesheet hours and billing metrics with resource utilization chart
- **Employees Page**: Employee performance with hours, revenue, and utilization metrics (Underutilization, Lost Revenue, Utilization %, Time Off)
- **Employee Management**: Manage employee information with enrichment data and physical person grouping
- **Company Management**: View and manage companies with grouping support for multi-system entities
- **Projects Page**: View projects organized by company with export capability
- **Rates Page**: Manage monthly billing rates per project with average rate metrics
- **Revenue Page**: Track billable hours and revenue with drill-down views and billing limits (MIN/MAX/Carryover)
- **Holidays Page**: Manage Bulgarian holidays for working days calculations

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS (Vercel-Neo-Minimalist theme)
- **Database**: Supabase (PostgreSQL)
- **Deployment**: Vercel
- **Data Sync**: n8n workflow integration with Clockify

## Database Schema

### Tables

#### `timesheet_daily_rollups`
Stores raw Clockify time entries synced via n8n.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| clockify_workspace_id | TEXT | Clockify workspace identifier |
| user_id | TEXT | Clockify user ID |
| user_name | TEXT | Display name from Clockify |
| project_name | TEXT | Project name |
| task_id | TEXT | Clockify task ID (nullable) |
| task_name | TEXT | Task name |
| work_date | DATE | Date of work |
| total_minutes | INTEGER | Duration in minutes |
| hourly_rate | NUMERIC | Billing rate |
| created_at | TIMESTAMPTZ | Record creation timestamp |
| updated_at | TIMESTAMPTZ | Last update timestamp |

**Unique Constraint**: Partial unique index on `(clockify_workspace_id, task_id) WHERE task_id IS NOT NULL`

#### `resources`
Employee records with enrichment data.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | TEXT | Clockify user ID (nullable, unique when not null) |
| external_label | TEXT | Display name (from Clockify user_name) |
| first_name | TEXT | Employee first name |
| last_name | TEXT | Employee last name |
| email | TEXT | Employee email |
| teams_account | TEXT | Microsoft Teams account |
| employment_type_id | UUID | FK to employment_types |
| created_at | TIMESTAMPTZ | Record creation timestamp |
| updated_at | TIMESTAMPTZ | Last update timestamp |

#### `employment_types`
Lookup table for employment classifications.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Type name ('Full-time', 'Part-time') |
| created_at | TIMESTAMPTZ | Record creation timestamp |

#### `companies`
Company records auto-provisioned from projects.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| client_id | TEXT | External client ID from time tracking (unique) |
| client_name | TEXT | Original name from time tracking system |
| display_name | TEXT | Custom display name (nullable) |
| created_at | TIMESTAMPTZ | Record creation timestamp |
| updated_at | TIMESTAMPTZ | Last update timestamp |

**Note**: Companies are auto-provisioned when projects are synced. A special `__UNASSIGNED__` company exists for projects without a client.

#### `company_groups` / `company_group_members`
Support grouping multiple company entities (from different time tracking systems) that represent the same organization.

| Table | Key Columns | Description |
|-------|-------------|-------------|
| company_groups | id, primary_company_id | Group anchor record |
| company_group_members | group_id, member_company_id | Member associations |

### Views

#### `v_timesheet_entries`
Normalized view of timesheet data for frontend consumption.

#### `v_company_table_entities`
Filtered view for Companies table (excludes member companies, shows only primary and unassociated).

#### `v_company_canonical`
Maps any company_id to its canonical (primary) company_id for grouping lookups.

### Triggers

#### `trg_auto_create_resource`
Automatically creates a resource record when a new user appears in `timesheet_daily_rollups`.

- **Event**: AFTER INSERT OR UPDATE
- **Table**: timesheet_daily_rollups
- **Action**: Creates resource if `user_id` doesn't exist, defaults to 'Full-time' employment type

## n8n Integration

The application syncs data from Clockify via n8n workflows:

1. **Time Entries Sync**: Fetches raw time entries and upserts to `timesheet_daily_rollups`
2. **Auto Resource Creation**: Trigger automatically creates employee records for new users

### Required Fields from n8n

When syncing time entries, ensure these fields are populated:
- `clockify_workspace_id`
- `user_id` (Clockify user ID)
- `user_name` (display name)
- `task_id` (if applicable)
- `total_minutes` (duration)
- `work_date`

## Development

```bash
# Install dependencies
npm install

# Run TypeScript validation
npx tsc --noEmit

# Deploy to Vercel (production)
vercel --prod
```

**Note**: All testing should be done via Vercel deployments. Do not run local dev server unless explicitly needed.

## Project Structure

```
src/
├── components/
│   ├── atoms/
│   │   ├── RangeSelector.tsx      # Reusable date range selector (variants: export, dateRange, exportOnly)
│   │   ├── RevenueTable.tsx       # Revenue breakdown table
│   │   └── charts/
│   │       └── DailyHoursChart.tsx # Resource utilization heatmap chart
│   ├── pages/
│   │   ├── EmployeesPage.tsx      # Employee performance with utilization metrics
│   │   ├── EmployeeManagementPage.tsx # Employee data management
│   │   ├── CompaniesPage.tsx      # Company management page
│   │   ├── ProjectsPage.tsx       # Projects view page
│   │   ├── RatesPage.tsx          # Monthly rates management
│   │   ├── RevenuePage.tsx        # Revenue tracking page
│   │   ├── HolidaysPage.tsx       # Holiday management
│   │   └── DiagnosticsPage.tsx    # Data diagnostics and validation
│   ├── EmployeePerformance.tsx    # Employee hours/revenue accordion table
│   ├── EmployeeEditorModal.tsx    # Employee edit modal
│   ├── CompanyEditorModal.tsx     # Company edit modal
│   ├── CompanyGroupSection.tsx    # Company grouping UI
│   └── ResourceTable.tsx          # Employee data table
├── hooks/
│   ├── useResources.ts            # Fetch/update resources
│   ├── useEmployeeTableEntities.ts # Fetch employees (excludes grouped members)
│   ├── useCompanies.ts            # Fetch companies with grouping
│   ├── useCompanyGroup.ts         # Fetch company group data
│   ├── useCompanyGroupMutations.ts # Company group CRUD operations
│   ├── useMonthlyRates.ts         # Monthly rate management
│   ├── useUnifiedBilling.ts       # Unified billing calculations
│   ├── useTimeOff.ts              # Employee time-off records
│   ├── useEmploymentTypes.ts      # Fetch employment types
│   ├── useCanonicalCompanyMapping.ts # Company canonical name resolution
│   └── useTimesheetData.ts        # Fetch timesheet entries with lookups
├── utils/
│   ├── billing.ts                 # Billing utilities (formatting, rounding)
│   ├── billingCalculations.ts     # Unified billing calculation engine
│   ├── calculations.ts            # Hour/minute calculations
│   └── holidays.ts                # Bulgarian holiday calculations
├── types/
│   └── index.ts                   # TypeScript interfaces
└── lib/
    └── supabase.ts                # Supabase client config

supabase/
└── migrations/
    ├── 006_create_timesheet_view.sql
    ├── 007_enhance_resources_schema.sql
    ├── ...
    ├── 022_create_companies_table.sql    # Companies table with auto-provisioning
    ├── 023_company_grouping.sql          # Company grouping infrastructure
    ├── 024_create_unassigned_company.sql # Unassigned company for NULL clients
    └── 025_remove_company_notes.sql      # Remove notes column
```

## Migrations

Run migrations in order via Supabase SQL Editor:

1. `006_create_timesheet_view.sql` - Creates `v_timesheet_entries` view
2. `007_enhance_resources_schema.sql` - Adds `employment_types` table, updates `resources` schema, creates auto-insert trigger
3. ...
4. `022_create_companies_table.sql` - Creates companies table with FK to projects, auto-provisions from existing projects
5. `023_company_grouping.sql` - Adds company grouping tables, views, and RPC functions for multi-system entity grouping
6. `024_create_unassigned_company.sql` - Creates "Unassigned" company for projects with NULL client_id
7. `025_remove_company_notes.sql` - Removes unused notes column from companies table
