# Timesheet Billing Manager

A React-based timesheet and billing management application that integrates with Clockify for time tracking data.

## Features

- **Dashboard**: Overview of timesheet hours and billing metrics
- **Employees Page**: Manage employee information with enrichment data
- **Timesheet View**: Detailed view of time entries with filtering
- **Billing Integration**: Track billable hours and revenue

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

### Views

#### `v_timesheet_entries`
Normalized view of timesheet data for frontend consumption.

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
│   ├── pages/
│   │   └── EmployeesPage.tsx    # Employee management page
│   ├── EmployeeEditorDrawer.tsx # Employee edit form
│   └── ResourceTable.tsx        # Employee data table
├── hooks/
│   ├── useResources.ts          # Fetch/update resources
│   ├── useEmploymentTypes.ts    # Fetch employment types
│   └── useTimesheetData.ts      # Fetch timesheet entries
├── types/
│   └── index.ts                 # TypeScript interfaces
└── lib/
    └── supabase.ts              # Supabase client config

supabase/
└── migrations/
    ├── 006_create_timesheet_view.sql
    └── 007_enhance_resources_schema.sql
```

## Migrations

Run migrations in order via Supabase SQL Editor:

1. `006_create_timesheet_view.sql` - Creates `v_timesheet_entries` view
2. `007_enhance_resources_schema.sql` - Adds `employment_types` table, updates `resources` schema, creates auto-insert trigger
