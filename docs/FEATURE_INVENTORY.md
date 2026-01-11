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
| F026 | Navigation System | Complete | P0 | SubNavbar.tsx, MainHeader.tsx |

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
└── Dashboard.tsx
    ├── DateRangeFilter.tsx
    ├── UnderHoursAlert.tsx
    ├── StatsOverview.tsx
    ├── BillingRatesTable.tsx
    └── ProjectCard.tsx
        └── ResourceRow.tsx
            └── TaskList.tsx

Hooks:
└── useTimesheetData.ts
    └── supabase.ts

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
| `src/App.tsx` | Component | 7 | Root component |
| `src/components/Dashboard.tsx` | Component | 110 | Main dashboard |
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
| `src/components/SubNavbar.tsx` | Component | 45 | Navigation tabs |
| `src/components/MainHeader.tsx` | Component | 85 | App header with user menu |
| `src/components/DropdownMenu.tsx` | Component | 150 | Reusable dropdown |
| `src/components/Select.tsx` | Component | 80 | Reusable select input |
| `src/components/Modal.tsx` | Component | 135 | Reusable modal |

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
| Error Display | Shows auth errors |
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
**Components**: `SubNavbar.tsx`, `MainHeader.tsx`
**Description**: Application navigation and header.

| Route | Page |
|-------|------|
| home | Dashboard |
| holidays | Bulgarian Holidays |
| employees | Employee Management |
| rates | Project Rates |
| eom-reports | EOM Reports |
| users | User Management |

**MainHeader Features**:
- App title
- User avatar with initial
- Sign out dropdown
