# Timesheet & Billing Manager - Project Summary

**Last Updated:** 2026-01-11
**Production URL:** https://timesheet-billing-manager.vercel.app
**Repository:** https://github.com/matthewmaday-thebteam/timesheet-billing-manager

---

## Project Overview

A React/TypeScript dashboard application for tracking timesheet data, billing rates, and revenue metrics for The B Team consulting company. Built with Vite, Tailwind CSS v4, and Supabase.

---

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 19.x | UI Framework |
| TypeScript | 5.x | Type Safety |
| Vite | 7.x | Build Tool |
| Tailwind CSS | 4.x | Styling (with @theme tokens) |
| Supabase | - | Database & Auth |
| Recharts | 2.x | Chart Visualization |
| Vercel | - | Hosting & Deployment |

---

## Key Features

### Dashboard (Main View)
- **Date Range Filter**: Current month, month selector, or custom range
- **Charts Row**:
  - Pie chart (Hours by Resource)
  - Line chart (12-Month Revenue Trend)
- **KPI Stats Cards**: Total Hours, Revenue, Projects, Resources, Under Target
- **Billing Rates Table**: Expandable table with inline editing
- **Project Cards**: Expandable accordion showing resources and tasks

### Authentication
- Email/password login via Supabase Auth
- Password reset flow
- Session management

### Admin Features
- User management (CRUD operations)
- Employee management
- Project rates configuration
- Bulgarian holidays management

---

## Design System

### Color Tokens (src/index.css @theme)
- **Vercel Gray Scale**: vercel-gray-50 through vercel-gray-600
- **Brand Colors**: brand-indigo (#667eea), brand-purple (#764ba2)
- **B Team Brand**: bteam-brand (#E50A73) - used for Revenue line
- **Semantic**: success, warning, error, info

### Typography
- **Font Stack**: font-mono for data/numbers, system fonts for UI
- **Chart Text**: Always uses font-mono

### Component Library
- Atoms: Button, Input, Card, Badge, Spinner, DatePicker, MetricCard
- Charts: PieChartAtom, LineGraphAtom (with chartTheme.ts adapter)
- Molecules: AccordionNested, AccordionFlat, DashboardChartsRow

---

## Chart Configuration

### Line Graph (12-Month Revenue Trend)
| Line | Color | Style | Value |
|------|-------|-------|-------|
| Target ($1.8M) | brand-indigo | Solid | $150k/month cumulative |
| Budget ($1M) | brand-purple | Dashed | ~$83k/month cumulative |
| Revenue | bteam-brand (pink) | Solid | Cumulative earned, extends flat into future |

### Pie Chart (Hours by Resource)
- Top 5 resources shown individually
- Remainder grouped into "Other" (gray)
- Donut style (inner radius: 60, outer radius: 80)

---

## File Structure

```
src/
├── components/
│   ├── atoms/charts/
│   │   ├── chartTheme.ts      # Design token mappings
│   │   ├── PieChartAtom.tsx   # Donut pie chart
│   │   └── LineGraphAtom.tsx  # Time series line chart
│   ├── pages/                 # Route pages
│   ├── Dashboard.tsx          # Main dashboard
│   ├── DashboardChartsRow.tsx # Charts container molecule
│   └── [other components]
├── config/
│   └── chartConfig.ts         # Chart constants
├── contexts/
│   └── AuthContext.tsx        # Authentication state
├── hooks/
│   ├── useTimesheetData.ts    # Data fetching
│   └── useAdminUsers.ts       # Admin operations
├── types/
│   ├── index.ts               # Core types
│   └── charts.ts              # Chart-specific types
├── utils/
│   ├── calculations.ts        # Data aggregation
│   ├── chartTransforms.ts     # Chart data transforms
│   ├── billing.ts             # Revenue calculations
│   └── holidays.ts            # Bulgarian holidays
└── index.css                  # Design tokens (@theme)

docs/
├── STYLEGUIDE.md              # Design system guide (v1.5.1)
├── FEATURE_INVENTORY.md       # Feature documentation
└── PROJECT_SUMMARY.md         # This file
```

---

## Development Workflow

### Critical Rules
1. **NEVER start local dev server** unless explicitly requested
2. **NEVER build locally** unless explicitly requested
3. TypeScript validation (`npx tsc --noEmit`) CAN be run before deploying
4. All testing via Vercel deployments
5. Always deploy to production: `vercel --prod`

### Deployment
```bash
cd "/mnt/c/Users/Matthew/Dropbox/Organizations/Concept Companies/timesheet-billing-manager"
vercel --prod
```

### Database Backup
```bash
export $(grep -v '^#' .env | xargs)
./scripts/backup-database.sh
```

---

## Recent Changes (2026-01-11)

### v1.5.1 - Charts Refinements
- Revenue line uses The B Team brand color (#E50A73)
- Revenue line extends as flat horizontal line into future months
- Removed black outline on clicked chart elements
- Legend labels: "Target ($1.8M)", "Budget ($1M)"

### v1.5.0 - Charts Feature
- Added PieChartAtom and LineGraphAtom
- Added DashboardChartsRow molecule
- Charts show cumulative values (Target, Budget, Revenue)
- All chart text uses font-mono
- All colors use CSS custom properties

---

## Key Configuration Values

| Constant | Value | Location |
|----------|-------|----------|
| ANNUAL_BUDGET | $1,000,000 | src/config/chartConfig.ts |
| TARGET_RATIO | 1.8 | src/config/chartConfig.ts |
| TOP_N_RESOURCES | 5 | src/config/chartConfig.ts |
| CHART_HEIGHT | 250px | src/config/chartConfig.ts |

---

## Supabase Tables

- `timesheet_daily_rollups` - Aggregated timesheet entries
- `employees` - Employee records
- `project_rates` - Billing rates per project
- `bulgarian_holidays` - Holiday calendar
- Auth tables managed by Supabase

---

## Notes for Tomorrow

1. Charts are fully functional with cumulative revenue tracking
2. Design system is enforced via ESLint token linting
3. All deployments go through `vercel --prod`
4. Database backups stored in `backups/` directory (gitignored)
5. Style Review Surface available at `?style-review=true` query param
