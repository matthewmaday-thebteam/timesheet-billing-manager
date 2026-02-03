# Timesheet Billing Manager - Project Overview

> Startup reference for Claude Code sessions.

## Project Summary

React 19 + TypeScript 5.9 + Vite 7.2 application for timesheet tracking, billing, and revenue analytics. Syncs time data from Clockify via n8n workflows, stores everything in Supabase (PostgreSQL), and deploys to Vercel.

---

## Connections

### Git
- **Branch:** `main`
- **Remote:** `https://github.com/matthewmaday-thebteam/timesheet-billing-manager.git`

### Vercel
- **Project ID:** `prj_RfqTJlUvrMHQiiBIKfPTB7yz416u`
- **Org ID:** `team_bKInwfIze4yvKkhVpFqN7BH0`
- **Project name:** `timesheet-billing-manager`
- **Framework:** Vite
- **Build command:** `npm run ci:check && npm run build`
- **Output directory:** `dist`
- **Routing:** SPA rewrite `/(.*) -> /` in `vercel.json`
- **Deploy:** Always production only (`vercel --prod`)

### Supabase
- **URL:** `https://yptbnsegcfpizwhipeep.supabase.co`
- **Client init:** `src/lib/supabase.ts` (uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` env vars)
- **Auth:** Email/password, auto-refresh, session persistence, 15-min inactivity timeout
- **Migrations:** 46 SQL files in `supabase/migrations/`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript 5.9 |
| Build | Vite 7.2 |
| Styling | Tailwind CSS 4.1 (custom Neo-Minimalist theme) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email/password) |
| Time sync | n8n workflows from Clockify |
| HR sync | BambooHR (employee_time_off) |
| Charts | Recharts 3.6 |
| Hosting | Vercel (production deploys only) |
| VCS | GitHub (`main` branch) |

---

## Key Database Tables

| Table | Purpose |
|---|---|
| `timesheet_daily_rollups` | Raw time entries synced from Clockify |
| `resources` | Employee records with enrichment (FK to `employment_types`) |
| `employment_types` | Lookup: Full-time, Part-time |
| `companies` | Auto-provisioned from Clockify projects |
| `company_groups` / `company_group_members` | Multi-system company grouping |
| `project_monthly_rates` | Rate management by project/month |
| `project_monthly_rounding` | Rounding rules (0, 5, 15, 30 min increments) |
| `billings` / `billing_transactions` | Billing records and transactions |
| `employee_time_off` | Time-off from BambooHR |
| `legal_documents` | Versioned Terms/Privacy content |

### Key Views
- `v_timesheet_entries` - Normalized timesheet data for frontend
- `v_company_table_entities` - Filtered company view (excludes group members)
- `v_company_canonical` - Maps any company_id to its canonical (grouped) company

---

## Folder Structure

```
src/
  components/
    atoms/           # Foundational atoms (charts, tables)
    molecules/       # Composed components (DateCycle, RangeSelector)
    chat/            # Chat-related components
    pages/           # 18 page components (see list below)
    [modals, tables] # EditorModals, Tables, Sections
  hooks/             # 32 custom React hooks
  utils/             # Billing calcs, formatting, holidays, diagnostics
  contexts/          # AuthContext, DateFilterContext
  lib/
    supabase.ts      # Supabase client initialization
  types/
    index.ts         # All TypeScript interfaces (~970 lines)
  design-system/     # Design tokens, typography, style review
  config/
    chartConfig.ts   # Dashboard chart constants
  assets/            # Static assets
  App.tsx            # Main app routing
```

---

## Pages (18)

1. **Dashboard** - Main overview with metrics
2. **EmployeesPage** - Performance metrics (utilization, revenue, time-off)
3. **EmployeeManagementPage** - CRUD for employee data
4. **CompaniesPage** - Company management with grouping
5. **ProjectsPage** - Projects organized by company
6. **ProjectManagementPage** - Project CRUD
7. **RatesPage** - Monthly rate management
8. **RevenuePage** - Billable hours and revenue tracking
9. **BillingsPage** - Billing transactions management
10. **HolidaysPage** - Bulgarian holiday management
11. **EOMReportsPage** - End-of-month reporting
12. **UsersPage** - Admin user management
13. **DiagnosticsPage** - Data validation diagnostics
14. **FormulasPage** - Billing formula documentation
15. **InvestorDashboardPage** - Key investor metrics
16. **LegalPage** - Versioned legal documents (Terms, Privacy)
17. **LoginPage** - Authentication
18. **ForgotPasswordPage / ResetPasswordPage** - Password recovery

---

## NPM Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start local dev server (only when explicitly requested) |
| `npm run build` | TypeScript + Vite build (only when explicitly requested) |
| `npm run lint` | ESLint check |
| `npm run lint:tokens` | Design token validation |
| `npm run typecheck` | TypeScript validation (`npx tsc --noEmit`) |
| `npm run ci:check` | typecheck + lint:tokens (runs before Vercel build) |

---

## Key Integrations

- **Clockify** - Time tracking source, synced via n8n to `timesheet_daily_rollups`
- **BambooHR** - HR source for employee time-off data (`bamboo_employee_id` on resources)
- **n8n** - Workflow automation (configs in `n8n/` directory)

---

## Data Integrity Rules (from CLAUDE.md)

- ALWAYS use unique IDs for lookups, NEVER names/strings
- `project_id` or `id` for projects, `client_id` for companies, `user_id` for users
- Failed ID lookups are DATA ERRORS - never silently fall back to name matching
- All billing calculations must be traceable by ID through the entire pipeline

---

## Design System Components

### Atoms (src/components/)
| Component | Purpose |
|-----------|---------|
| `Button` | Primary, secondary, ghost, danger variants with sizes |
| `Input` | Form input with label, error, helperText, startAddon/endAddon |
| `Select` | Dropdown select |
| `Toggle` | Switch component with label/description |
| `Spinner` | Loading indicator |
| `ChevronIcon` | Directional chevron (left/right/up/down) with animation |
| `Modal` | Dialog component |
| `Badge` | Status badges |
| `Card` | Container component |

### Molecules (src/components/molecules/)
| Component | Purpose |
|-----------|---------|
| `DateCycle` | Month navigation (left arrow, date display, right arrow) |
| `RangeSelector` | Date range selection with mode buttons and export options |

---

## Recent Changes (2026-02-03)

### DateCycle & RateEditModal Integration
- **New molecule:** `DateCycle` - Reusable month navigation component
- **New hook:** `useSingleProjectRate` - Fetches rate data for a single project/month
- **RateEditModal** now supports navigating between months to view/edit rates for different periods
- Users can change months within the modal and save to the displayed month

### Design System Improvements
- Extended `Input` atom with `startAddon`/`endAddon` props for currency symbols
- Extended `ChevronIcon` atom with `direction` prop (left/right/up/down)
- Reclassified `RangeSelector` from Atom to Molecule (moved to molecules/ folder)
- Standardized label styling and border colors across modal forms
