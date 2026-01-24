# Timesheet & Billing Manager - Feature Inventory

## Feature Summary

| ID | Feature | Status | Priority | Component |
|----|---------|--------|----------|-----------|
| F001 | Dashboard Overview | Complete | P0 | Dashboard.tsx |
| F002 | Stats Cards | Complete | P0 | StatsOverview.tsx |
| F003 | Date Range Filter | Complete | P0 | DateRangeFilter.tsx |
| F004 | Under Hours Alert | Complete | P0 | UnderHoursAlert.tsx |
| F005 | Project Cards | Complete | P0 | ProjectCard.tsx |
| F006 | Resource Rows | Complete | P0 | ResourceRow.tsx |
| F007 | Task List | Complete | P0 | TaskList.tsx |
| F008 | Bulgarian Holiday Calculator | Complete | P0 | holidays.ts |
| F009 | Working Days Calculation | Complete | P0 | holidays.ts |
| F010 | Data Aggregation | Complete | P0 | calculations.ts |
| F011 | Supabase Integration | Complete | P0 | supabase.ts |
| F012 | Manual Data Refresh | Complete | P1 | Dashboard.tsx |
| F013 | Billing Rates Table | Complete | P1 | BillingRatesTable.tsx |
| F014 | Revenue Calculation | Complete | P1 | billing.ts |
| F015 | Revenue Stats Card | Complete | P1 | StatsOverview.tsx |
| F016 | User Authentication | Complete | P0 | AuthContext.tsx |
| F017 | Login Page | Complete | P0 | LoginPage.tsx |
| F018 | Password Reset Flow | Complete | P0 | ForgotPasswordPage.tsx, ResetPasswordPage.tsx |
| F019 | User Management Page | Complete | P0 | UsersPage.tsx |
| F020 | User Table | Complete | P0 | UserTable.tsx |
| F021 | User Editor Modal | Complete | P0 | UserEditorModal.tsx |
| F022 | Admin User CRUD | Complete | P0 | useAdminUsers.ts |
| F023 | Bulgarian Holidays Page | Complete | P1 | HolidaysPage.tsx |
| F024 | Employees Page | Complete | P1 | EmployeesPage.tsx |
| F025 | Project Rates Page | Complete | P1 | RatesPage.tsx |
| F026 | Navigation System | Complete | P0 | MainHeader.tsx |
| F027 | Dashboard Charts | Complete | P1 | DashboardChartsRow.tsx |
| F028 | Hours by Resource Chart | Complete | P1 | PieChartAtom.tsx |
| F029 | Revenue Trend Chart | Complete | P1 | LineGraphAtom.tsx |
| F030 | Profile Editor Modal | Complete | P1 | ProfileEditorModal.tsx |
| F031 | Dashboard Personalized Greeting | Complete | P2 | Dashboard.tsx |
| F032 | Avatar Upload | Complete | P1 | AvatarUpload.tsx |
| F033 | Toggle Atom | Complete | P1 | Toggle.tsx |
| F034 | Alert Atom | Complete | P1 | Alert.tsx |
| F035 | Employee Performance | Complete | P1 | EmployeePerformance.tsx |
| F036 | Per-Project Monthly Rounding | Complete | P1 | RateEditModal.tsx, useMonthlyRates.ts |
| F037 | MoM Growth Rate Chart | Complete | P1 | BarChartAtom.tsx |
| F038 | CAGR Projection Chart | Complete | P1 | CAGRChartAtom.tsx |
| F039 | Best/Worst Case Projections | Complete | P1 | LineGraphAtom.tsx |

---

## Detailed Feature Descriptions

### F001: Dashboard Overview
**Component**: `src/components/Dashboard.tsx`
**Description**: Main container component that orchestrates the entire dashboard view.

| Capability | Details |
|------------|---------|
| Layout | Header + main content area |
| State Management | Date range state with useState |
| Data Fetching | useTimesheetData hook integration |
| Error Handling | Error message display |
| Loading State | Spinner with loading message |

---

### F002: Stats Cards
**Component**: `src/components/StatsOverview.tsx`
**Description**: Five summary statistic cards displayed at top of dashboard.

| Card | Data Source | Color |
|------|-------------|-------|
| Total Hours | Sum of all project minutes / 60 | Blue |
| Total Revenue | Sum of (hours × rate) per project | Green |
| Projects | projects.length | Indigo |
| Resources | resources.length | Purple |
| Resources Under Target | underHoursItems.length | Red (if > 0) / Gray |

---

### F003: Date Range Filter
**Component**: `src/components/DateRangeFilter.tsx`
**Description**: Three-mode date selection interface.

| Mode | UI Element | Behavior |
|------|------------|----------|
| Current Month | Button | Sets range to 1st of month → end of month |
| Select Month | Prev/Next arrows + month display | Navigate months |
| Custom Range | Two date inputs | Manual start/end selection |

**State**:
- `mode`: 'current' | 'month' | 'custom'
- `selectedMonth`: Date for month navigation

---

### F004: Under Hours Alert
**Component**: `src/components/UnderHoursAlert.tsx`
**Description**: Warning banner showing resources below hour target.

| Element | Content |
|---------|---------|
| Header | Count of under-hours resources + prorated target |
| Subheader | Monthly target + working days info |
| Resource List | Name, actual hours, expected hours, deficit |

**Props**:
- `items`: UnderHoursResource[]
- `expectedHours`: number
- `workingDaysElapsed`: number
- `workingDaysTotal`: number

---

### F005: Project Cards
**Component**: `src/components/ProjectCard.tsx`
**Description**: Expandable card showing project summary.

| State | Display |
|-------|---------|
| Collapsed | Project name, resource count, total hours |
| Expanded | + ResourceRow for each team member |

**Interaction**: Click to expand/collapse

---

### F006: Resource Rows
**Component**: `src/components/ResourceRow.tsx`
**Description**: Expandable row within project showing resource hours.

| State | Display |
|-------|---------|
| Collapsed | Resource name, hours on project |
| Expanded | + TaskList showing all tasks |

**Interaction**: Click to expand/collapse

---

### F007: Task List
**Component**: `src/components/TaskList.tsx`
**Description**: Detailed task breakdown with daily entries.

| Element | Content |
|---------|---------|
| Task Row | Task name, total hours |
| Date Entries | Up to 5 dates shown, "+N more" for overflow |

---

### F008: Bulgarian Holiday Calculator
**Component**: `src/utils/holidays.ts`
**Description**: Dynamic calculation of Bulgarian public holidays.

| Function | Purpose |
|----------|---------|
| `getOrthodoxEaster(year)` | Calculate Orthodox Easter date |
| `getBulgarianHolidays(year)` | Return all holidays for a year |
| `isBulgarianHoliday(date)` | Check if date is a holiday |

**Holidays Calculated**:
- 10 fixed-date holidays
- 4 Easter-related holidays (variable dates)

---

### F009: Working Days Calculation
**Component**: `src/utils/holidays.ts`
**Description**: Calculate working days excluding weekends and holidays.

| Function | Purpose |
|----------|---------|
| `isWorkingDay(date)` | Check if date is a working day |
| `countWorkingDays(start, end)` | Count working days in range |
| `getWorkingDaysInMonth(date)` | Get total and elapsed working days |

---

### F010: Data Aggregation
**Component**: `src/utils/calculations.ts`
**Description**: Transform raw timesheet entries into hierarchical views.

| Function | Output |
|----------|--------|
| `aggregateByProject()` | ProjectSummary[] with nested resources/tasks |
| `aggregateByResource()` | ResourceSummary[] with tasks (for under-hours) |
| `getUnderHoursResources()` | UnderHoursResource[] filtered list |
| `getProratedExpectedHours()` | Calculated expected hours |

---

### F011: Supabase Integration
**Component**: `src/lib/supabase.ts` + `src/hooks/useTimesheetData.ts`
**Description**: Database connection and data fetching.

| Element | Purpose |
|---------|---------|
| Supabase Client | Configured with URL + service role key |
| useTimesheetData Hook | Fetch, cache, and aggregate data |

**Query**: `timesheet_daily_rollups` filtered by date range

---

### F012: Manual Data Refresh
**Component**: `src/components/Dashboard.tsx`
**Description**: Button to manually reload data.

| Element | Behavior |
|---------|----------|
| Refresh Button | Calls `refetch()` from useTimesheetData |
| Location | Dashboard header, right side |

---

### F013: Billing Rates Table
**Component**: `src/components/BillingRatesTable.tsx`
**Description**: Expandable table for viewing and editing project billing rates.

| Feature | Description |
|---------|-------------|
| Expandable | Collapsed by default, shows total revenue summary |
| Inline Edit | Click rate to edit, Enter/Escape to save/cancel |
| Auto-save | Rates persist to localStorage on change |
| Sorting | Projects sorted by revenue (highest first) |

**Props**:
- `projects`: ProjectSummary[]
- `onRatesChange`: () => void (callback to trigger re-render)

---

### F014: Revenue Calculation
**Component**: `src/utils/billing.ts`
**Description**: Billing rate management and revenue calculation utilities.

| Function | Purpose |
|----------|---------|
| `getBillingRates()` | Load rates from localStorage with defaults |
| `setProjectRate()` | Save rate for a project |
| `calculateProjectRevenue()` | Calculate revenue for one project |
| `calculateTotalRevenue()` | Calculate revenue across all projects |
| `formatCurrency()` | Format number as USD currency string |

**Default Rates**: Pre-configured for known clients (FoodCycleScience, Neocurrency, etc.)

---

### F015: Revenue Stats Card
**Component**: `src/components/StatsOverview.tsx`
**Description**: Total Revenue card in stats overview.

| Property | Value |
|----------|-------|
| Color | Green (bg-green-50, text-green-700) |
| Format | USD currency ($X,XXX.XX) |
| Position | Second card (after Total Hours) |

---

## Component Dependency Map

```
App.tsx
├── AuthProvider (context)
├── MainHeader.tsx
│   ├── NavItem.tsx (navigation tabs)
│   ├── Avatar.tsx
│   └── ProfileEditorModal.tsx
│       ├── AvatarUpload.tsx
│       │   ├── Avatar.tsx
│       │   └── Modal.tsx (crop modal)
│       ├── Input.tsx
│       └── Modal.tsx
└── Dashboard.tsx
    ├── DateRangeFilter.tsx
    │   ├── Button.tsx
    │   └── DatePicker.tsx
    ├── DashboardChartsRow.tsx
    │   ├── PieChartAtom.tsx
    │   ├── LineGraphAtom.tsx (with best/worst case projections)
    │   ├── BarChartAtom.tsx (MoM Growth Rate)
    │   └── CAGRChartAtom.tsx (CAGR Projection)
    ├── StatsOverview.tsx
    │   └── MetricCard.tsx (5 cards)
    ├── BillingRatesTable.tsx
    │   └── AccordionFlat.tsx
    ├── ProjectCard.tsx
    │   └── AccordionNested.tsx (3-level hierarchy)
    └── UnderHoursModal.tsx

Reusable Atoms:
├── Button.tsx
├── Input.tsx
├── Toggle.tsx
├── Alert.tsx
├── Card.tsx
├── Badge.tsx
├── Spinner.tsx
├── DatePicker.tsx
├── MetricCard.tsx
├── Modal.tsx
├── Avatar.tsx
├── AvatarUpload.tsx
├── NavItem.tsx
├── Select.tsx
├── AccordionNested.tsx
└── AccordionFlat.tsx

Hooks:
├── useTimesheetData.ts
│   └── supabase.ts
├── useProjects.ts
├── useEmployees.ts
├── useHolidays.ts
└── useAdminUsers.ts

Utils:
├── calculations.ts
│   └── holidays.ts
├── billing.ts
└── holidays.ts
```

---

## File Inventory

| File | Type | Lines | Purpose |
|------|------|-------|---------|
| `src/App.tsx` | Component | 153 | Root component with auth routing |
| `src/components/Dashboard.tsx` | Component | 173 | Main dashboard with personalized greeting |
| `src/components/DateRangeFilter.tsx` | Component | 95 | Date selection |
| `src/components/StatsOverview.tsx` | Component | 60 | Stats cards (5 cards including revenue) |
| `src/components/UnderHoursAlert.tsx` | Component | 60 | Alert banner |
| `src/components/ProjectCard.tsx` | Component | 55 | Project display |
| `src/components/ResourceRow.tsx` | Component | 42 | Resource display |
| `src/components/TaskList.tsx` | Component | 35 | Task display |
| `src/components/BillingRatesTable.tsx` | Component | 180 | Billing rates editor |
| `src/hooks/useTimesheetData.ts` | Hook | 55 | Data fetching |
| `src/lib/supabase.ts` | Config | 10 | DB client |
| `src/utils/calculations.ts` | Utility | 215 | Aggregation logic |
| `src/utils/holidays.ts` | Utility | 115 | Holiday logic |
| `src/utils/billing.ts` | Utility | 55 | Billing rates & revenue |
| `src/types/index.ts` | Types | 146 | TypeScript interfaces |
| `src/contexts/AuthContext.tsx` | Context | 100 | Auth state management |
| `src/components/pages/LoginPage.tsx` | Component | 130 | Login form |
| `src/components/pages/ForgotPasswordPage.tsx` | Component | 100 | Password reset request |
| `src/components/pages/ResetPasswordPage.tsx` | Component | 175 | Set new password |
| `src/components/pages/UsersPage.tsx` | Component | 230 | User management |
| `src/components/UserTable.tsx` | Component | 190 | User list display |
| `src/components/UserEditorModal.tsx` | Component | 250 | Create/edit user |
| `src/hooks/useAdminUsers.ts` | Hook | 170 | Admin user operations |
| `src/components/pages/HolidaysPage.tsx` | Component | 250 | Holiday management |
| `src/components/pages/EmployeesPage.tsx` | Component | 200 | Employee management |
| `src/components/pages/RatesPage.tsx` | Component | 200 | Project rates |
| `src/components/MainHeader.tsx` | Component | 220 | Unified nav header with tabs, docs dropdown, user menu |
| `src/components/NavItem.tsx` | Component | 45 | Navigation tab item with active indicator |
| `src/components/ProfileEditorModal.tsx` | Component | 200 | Profile editing modal with avatar upload |
| `src/components/AvatarUpload.tsx` | Component | 285 | Avatar upload with crop functionality |
| `src/components/Avatar.tsx` | Component | 65 | Avatar display with initials fallback |
| `src/components/DropdownMenu.tsx` | Component | 150 | Reusable dropdown |
| `src/components/Select.tsx` | Component | 80 | Reusable select input |
| `src/components/Modal.tsx` | Component | 135 | Reusable modal |
| `src/components/Button.tsx` | Component | 80 | Reusable button |
| `src/components/Input.tsx` | Component | 98 | Reusable input field (error styling uses bteam-brand) |
| `src/components/Toggle.tsx` | Component | 58 | Reusable toggle switch with label/description |
| `src/components/Alert.tsx` | Component | 56 | Reusable alert box (subtle gray styling) |
| `src/components/EmployeePerformance.tsx` | Component | 122 | Employee hours/revenue using AccordionFlat pattern |
| `src/components/Card.tsx` | Component | 50 | Reusable card container |
| `src/components/Badge.tsx` | Component | 60 | Reusable status badge |
| `src/components/Spinner.tsx` | Component | 40 | Reusable loading spinner |
| `src/components/DatePicker.tsx` | Component | 50 | Reusable date picker |
| `src/components/MetricCard.tsx` | Component | 90 | Reusable metric display |
| `src/components/AccordionNested.tsx` | Component | 160 | 3-level collapsible accordion |
| `src/components/AccordionFlat.tsx` | Component | 130 | 2-level accordion with table |
| `src/components/DashboardChartsRow.tsx` | Component | 315 | Charts row with pie, line, bar, and CAGR charts |
| `src/components/atoms/charts/BarChartAtom.tsx` | Component | 145 | MoM Growth Rate bar chart |
| `src/components/atoms/charts/CAGRChartAtom.tsx` | Component | 161 | CAGR Projection line chart |
| `src/utils/chartTransforms.ts` | Utility | 250 | Chart data transformations (MoM, CAGR, projections) |
| `supabase/migrations/026_create_project_monthly_rounding.sql` | SQL | 150 | Project rounding configuration |
| `supabase/migrations/027_backfill_default_roundings.sql` | SQL | 25 | Backfill default rounding values |
| `src/design-system/style-review/StyleReviewPage.tsx` | Component | 600+ | Design system documentation |
| `supabase/migrations/012_create_avatars_storage.sql` | SQL | 45 | Avatars storage bucket with RLS |

---

## Authentication & User Management Features

### F016: User Authentication
**Component**: `src/contexts/AuthContext.tsx`
**Description**: React context providing authentication state and methods.

| Method | Purpose |
|--------|---------|
| `signIn(email, password)` | Sign in with credentials |
| `signOut()` | Sign out current user |
| `resetPassword(email)` | Send password reset email |
| `updatePassword(newPassword)` | Update user password |

**State**:
- `user`: Current authenticated user or null
- `session`: Supabase session object
- `loading`: Auth state loading indicator
- `isRecoverySession`: True during password reset flow

---

### F017: Login Page
**Component**: `src/components/pages/LoginPage.tsx`
**Description**: Authentication form with email/password login.

| Feature | Details |
|---------|---------|
| Email Input | Validated email field |
| Password Input | Masked password field |
| Error Display | Subtle gray styling (vercel-gray-50 bg, vercel-gray-200 border/icon/text) |
| Forgot Password Link | Links to password reset |
| Loading State | Shows spinner during auth |

---

### F018: Password Reset Flow
**Components**: `ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx`
**Description**: Complete password reset workflow.

| Step | Component | Action |
|------|-----------|--------|
| 1 | ForgotPasswordPage | User enters email, system sends reset link |
| 2 | Email | User clicks link, redirected to /reset-password |
| 3 | ResetPasswordPage | User enters new password, confirms |
| 4 | Success | User redirected to login |

---

### F019-F021: User Management
**Components**: `UsersPage.tsx`, `UserTable.tsx`, `UserEditorModal.tsx`
**Description**: Admin interface for managing application users.

| Feature | Description |
|---------|-------------|
| User List | Table showing all users with role, status, last login |
| Create User | Modal form to add new admin (with/without email invite) |
| Edit User | Update user role (admin/user) |
| Delete User | Remove user (protected: cannot delete last admin) |
| Reset Password | Send password reset email to any user |
| Stats Cards | Total users, admins, verified, pending counts |

---

### F022: Admin User CRUD Hook
**Component**: `src/hooks/useAdminUsers.ts`
**Description**: React hook for admin user management operations.

| Method | RPC Function | Purpose |
|--------|--------------|---------|
| `fetchUsers()` | `admin_list_users` | Get all users |
| `createUser(params)` | `admin_create_user` | Create new user |
| `updateUserRole(id, role)` | `admin_update_user_role` | Change user role |
| `deleteUser(id)` | `admin_delete_user` | Remove user |
| `sendPasswordResetEmail(email)` | Supabase Auth API | Trigger reset email |

---

### F026: Navigation System
**Component**: `src/components/MainHeader.tsx`
**Description**: Unified application navigation and header (merged SubNavbar into MainHeader).

| Route | Page |
|-------|------|
| home | Dashboard |
| holidays | Bulgarian Holidays |
| employees | Employee Management |
| rates | Project Rates |
| eom-reports | EOM Reports |
| users | User Management |

**MainHeader Features**:
- Left: Navigation tabs with active indicator
- Right: Feedback link, Docs dropdown, user avatar with dropdown
- User dropdown: Profile editor, Sign out
- Docs dropdown: Components, Styles (opens StyleReviewPage)
- NavItem component for consistent tab styling

---

### F030: Profile Editor Modal
**Component**: `src/components/ProfileEditorModal.tsx`
**Description**: Modal for editing user profile information and avatar.

| Feature | Details |
|---------|---------|
| Avatar Upload | Click to upload, crop, and save profile photo |
| Name Fields | First name, last name inputs |
| Email Field | Read-only display with helper text |
| Save/Cancel | Closes immediately on successful save |
| Error Handling | Error banner at top of form |

**Storage**: Avatars stored in Supabase `avatars` bucket with RLS policies

---

### F031: Dashboard Personalized Greeting
**Component**: `src/components/Dashboard.tsx`
**Description**: Time-based personalized greeting at top of dashboard.

| Time Range | Greeting |
|------------|----------|
| Before 12pm | Good Morning |
| 12pm - 5pm | Good Afternoon |
| After 5pm | Good Evening |

**Display**:
- Heading: "{Greeting}, {First Name} {Last Name}" in heading-2xl
- Subheading: "This is what is going on with The B Team today" in body-base
- "The B Team" styled with bteam-brand color (#E50A73)

---

### F032: Avatar Upload
**Component**: `src/components/AvatarUpload.tsx`
**Description**: Avatar display with upload and crop functionality.

| Feature | Details |
|---------|---------|
| Display | Shows current avatar or initials fallback |
| Upload | Click to select image file |
| Crop | Modal with react-easy-crop for circular crop |
| Zoom | Slider control for zoom level |
| Output | 256x256 JPEG, 90% quality |
| Max Size | 10MB file size limit |

**Integration**: Used in ProfileEditorModal for profile photo editing

---

### F033: Toggle Atom
**Component**: `src/components/Toggle.tsx`
**Description**: Reusable toggle switch with label and description.

| Feature | Details |
|---------|---------|
| Label | Required text displayed above toggle |
| Description | Optional helper text |
| States | On (gray-600) / Off (gray-100) |
| Disabled | Reduced opacity, non-interactive |

**Token Usage**: vercel-gray-50 (container bg), vercel-gray-100/600 (switch)

---

### F034: Alert Atom
**Component**: `src/components/Alert.tsx`
**Description**: Subtle alert box for displaying messages.

| Feature | Details |
|---------|---------|
| Message | Required text content |
| Icons | Error (circle with exclamation) or Info (circle with i) |
| Styling | Subtle gray (vercel-gray-50 bg, vercel-gray-200 border/icon/text) |

**Usage**: Login/forgot password error messages, edit mode notices

---

### F035: Employee Performance
**Component**: `src/components/EmployeePerformance.tsx`
**Description**: Dashboard section showing employee hours and revenue.

| Feature | Details |
|---------|---------|
| Pattern | Uses AccordionFlat (Billing Rates Pattern) |
| Columns | Employee, Hours, Revenue |
| Sorting | By revenue (highest first) |
| Footer | Totals row |
| Header | Dynamic employee count in subhead |

**Calculation**: Revenue = sum of (hours per project × project hourly rate)

---

### F027: Dashboard Charts
**Component**: `src/components/DashboardChartsRow.tsx`
**Description**: Multi-row responsive grid containing analytics charts for dashboard visualization.

| Feature | Details |
|---------|---------|
| Row 1 | 12-Month Revenue Trend (full width) |
| Row 2 | MoM Growth Rate (left) + CAGR Projection (right) |
| Row 3 | Hours by Resource (pie) + Top 5 By Hours + Top 5 By Revenue |
| Position | Between DateRangeFilter and KPI stats cards |
| Loading State | Shows Spinner in each card slot |
| Empty State | Returns null when no data available |

**Grid Configuration**:
- Row 1: Full width card
- Row 2: `grid-cols-2` on desktop
- Row 3: `grid-cols-3` on desktop
- Gap: `gap-4` (16px)
- Card padding: `lg` (24px)

---

### F028: Hours by Resource Chart
**Component**: `src/components/atoms/charts/PieChartAtom.tsx`
**Description**: Donut-style pie chart showing hours distribution by resource.

| Feature | Details |
|---------|---------|
| Chart Type | Donut (inner radius: 60, outer radius: 80) |
| Max Segments | 5 (groups remainder into "Other") |
| Height | 250px |
| Legend | Right side, vertical layout |
| Tooltip | Shows resource name and hours |

**Color Sequence**:
1. Brand Indigo
2. Brand Purple
3. Success (teal)
4. Warning (orange)
5. Info (deep indigo)
6. "Other" uses gray

---

### F029: Revenue Trend Chart
**Component**: `src/components/atoms/charts/LineGraphAtom.tsx`
**Description**: Line chart showing 12-month cumulative revenue trend against target, budget, and projections.

| Line | Description | Style |
|------|-------------|-------|
| Target ($1.8M) | Cumulative monthly target ($150k/month) | Solid indigo, 2px |
| Budget ($1M) | Cumulative monthly budget (~$83k/month) | Dashed purple, 2px |
| Revenue | Cumulative earned revenue | Solid B Team pink (#E50A73), 2px |
| Best Case | +15% projection envelope | Solid dark gray, 1.5px |
| Worst Case | -15% projection envelope | Solid dark gray, 1.5px |

**Features**:
- Full year display (Jan-Dec)
- Cumulative/compounding values
- Revenue line extends as flat horizontal line into future months
- Best/Worst case lines show projection envelope for future months
- Y-axis: Currency format ($XXk, $X.XM)
- Horizontal grid lines only
- Font-mono for all text elements
- No black outline on clicked elements

**Data Model**:
- Target and Budget show for all 12 months
- Revenue shows cumulative earned total, extending flat into future
- Best/Worst Case only show for future months (null for historical)
- Values compound monthly (e.g., March target = $450k)

---

### F036: Per-Project Monthly Rounding System
**Component**: `src/components/RateEditModal.tsx`, `src/hooks/useMonthlyRates.ts`
**Description**: Configurable per-project, per-month time rounding increments (law firm billing style).

| Feature | Details |
|---------|---------|
| Rounding Options | Actual (0), 5 min, 15 min (default), 30 min |
| Per-Task Rounding | Each task rounded individually before summing |
| Database Table | `project_monthly_rounding` with inheritance |
| UI Location | Rounding dropdown in Rate Edit Modal |
| History | Shows rounding history like rate history |

**Rounding Logic (Law Firm Style)**:
- Each individual task is rounded up by the increment
- Project total = sum of individually rounded tasks
- Example: Two 8-min tasks with 15-min rounding = 15 + 15 = 30 mins (not 16 → 30)

**Database Functions**:
- `get_effective_project_rounding(project_id, month)` - Returns increment with source tracking
- `get_all_project_roundings_for_month(month)` - Bulk fetch for all projects
- `set_project_rounding_for_month(project_id, month, increment)` - Upsert rounding

**Billing Utility**:
```typescript
function applyRounding(minutes: number, increment: RoundingIncrement): number {
  if (increment === 0) return minutes;
  return Math.ceil(minutes / increment) * increment;
}
```

---

### F037: MoM Growth Rate Chart
**Component**: `src/components/atoms/charts/BarChartAtom.tsx`
**Description**: Bar chart showing month-over-month revenue growth percentage.

| Feature | Details |
|---------|---------|
| Chart Type | Vertical bar chart |
| Data | Monthly percentage change: (current - previous) / previous × 100 |
| Colors | Green for positive growth, red for negative |
| Header Stat | Shows average MoM growth rate |
| Position | Below 12-Month Revenue Trend, left column |
| Height | 250px |

**Formula**: `MoM% = ((Month[n] - Month[n-1]) / Month[n-1]) × 100`

**Display**:
- First month shows null (no prior month for comparison)
- Tooltip shows exact percentage and revenue amount
- Y-axis formatted as percentage

---

### F038: CAGR Projection Chart
**Component**: `src/components/atoms/charts/CAGRChartAtom.tsx`
**Description**: Line chart showing actual cumulative revenue vs CAGR-based projection.

| Feature | Details |
|---------|---------|
| Chart Type | Dual-line chart |
| Actual Line | Solid B Team pink - cumulative revenue to date |
| Projected Line | Dashed gray - CAGR extrapolation |
| Header Stat | Shows projected annual revenue |
| Position | Below 12-Month Revenue Trend, right column |
| Height | 250px |

**CAGR Formula**:
```
Projected[n] = CurrentRevenue × (1 + avgMoMGrowth)^monthsRemaining
```

**Display**:
- Actual line ends at current month
- Projected line continues to December
- Tooltip shows both actual and projected values

---

### F039: Best/Worst Case Projection Lines
**Component**: `src/components/atoms/charts/LineGraphAtom.tsx`
**Description**: Two additional grey lines on the 12-Month Revenue Trend showing projection scenarios.

| Line | Description | Style |
|------|-------------|-------|
| Best Case | Revenue × 1.15 projection | Solid dark gray, 1.5px |
| Worst Case | Revenue × 0.85 projection | Solid dark gray, 1.5px |

**Features**:
- Lines begin from last month with actual data
- Extend to December showing projection envelope
- Use `chartColors.axisText` for consistent gray styling
- Lighter stroke width (1.5px) to not compete with main lines
- Only visible for future months (null for historical data)

**Data Transformation** (`chartTransforms.ts`):
```typescript
// Best case: +15% growth
bestCase: isFutureMonth ? lastRevenue * 1.15 : null
// Worst case: -15% growth
worstCase: isFutureMonth ? lastRevenue * 0.85 : null
```