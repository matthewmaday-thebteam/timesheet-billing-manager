# Task 029: BambooHR Time-Off Sync

**Status:** IN PROGRESS - Waiting for API Key

## 1. Problem Statement

Sync employee vacation/time-off data from BambooHR into Supabase to track scheduled absences for full-time and part-time employees.

## 2. Progress So Far

### Completed (2026-01-25)

#### Database
1. **`employee_time_off` table** - Stores time-off records synced from BambooHR
   - Migration: `supabase/migrations/20260125_create_employee_time_off.sql`
   - Auto-linking trigger to match resources by bamboo_employee_id or email

2. **`bamboo_employees` table** - Stores BambooHR employee directory for linking
   - Migration: `supabase/migrations/20260125_create_bamboo_employees.sql`
   - Fields: bamboo_id, first_name, last_name

3. **`resources.bamboo_employee_id` column** - Links resources to BambooHR
   - Migration: `supabase/migrations/20260125_add_bamboo_employee_id.sql`

#### Frontend Features
1. **Resource Utilization Chart** - Time-off reduces expected hours
   - Updated `DailyHoursChart.tsx` to accept timeOff prop
   - Subtracts employee's expected hours on days they're off
   - Full-time: -8 hours, Part-time: -4 hours

2. **Edit Employee Modal** - BambooHR User dropdown
   - Created `useBambooEmployees.ts` hook
   - Dropdown shows available BambooHR users (not already linked)
   - One BambooHR user can only be linked to one resource/group

3. **Holidays Page** - Employee Time Off section
   - Created `EmployeeTimeOffList.tsx` component
   - Shows all time-off records in chronological order
   - Groups by date, shows employee name and type
   - Indicates "(not linked)" for unlinked BambooHR users

4. **Holiday Calendar** - Time-off visualization
   - Updated `HolidayCalendar.tsx` to show time-off days
   - Time-off days display in success-light color
   - Holidays (red) take priority over time-off (green)

#### n8n Workflow
- Template created: `n8n/bamboo-time-off-sync.json`
- Needs API key to complete setup

### Blocked

**Need BambooHR API Key with proper permissions:**
- HR admin needs to grant "Manage API Keys" permission
- Settings → Access Levels → Enable "Manage API Keys"
- Then: Settings → API Keys → Add New Key

## 3. Next Steps (When API Key is Available)

### Step 1: Create API Key in BambooHR

1. Go to: https://thebteam.bamboohr.com/app/settings/permissions/access_levels
2. Find your access level, enable "Manage API Keys"
3. Go to: Settings → API Keys → Add New Key
4. Name it: "n8n Integration"
5. Copy the key (only shown once!)

### Step 2: Create n8n Code Node

```javascript
const subdomain = 'thebteam';
const apiKey = 'YOUR_API_KEY_HERE';

const auth = Buffer.from(`${apiKey}:x`).toString('base64');

// Get employee directory
const empResponse = await fetch(
  `https://api.bamboohr.com/api/gateway.php/${subdomain}/v1/employees/directory`,
  {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json'
    }
  }
);

if (!empResponse.ok) {
  throw new Error(`Employee API error: ${empResponse.status}`);
}

const empData = await empResponse.json();

// Build employee lookup
const employeeMap = new Map();
for (const emp of empData.employees) {
  employeeMap.set(emp.id, {
    name: emp.displayName,
    email: emp.workEmail || emp.homeEmail
  });
}

// Get time-off requests (next 90 days)
const today = new Date().toISOString().split('T')[0];
const futureDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

const toResponse = await fetch(
  `https://api.bamboohr.com/api/gateway.php/${subdomain}/v1/time_off/requests?start=${today}&end=${futureDate}&status=approved`,
  {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json'
    }
  }
);

if (!toResponse.ok) {
  throw new Error(`Time-off API error: ${toResponse.status}`);
}

const timeOffData = await toResponse.json();

// Transform to our schema
const results = [];
for (const req of timeOffData) {
  const emp = employeeMap.get(String(req.employeeId)) || {};

  results.push({
    json: {
      bamboo_request_id: String(req.id),
      bamboo_employee_id: String(req.employeeId),
      employee_name: emp.name || req.name || 'Unknown',
      employee_email: emp.email || null,
      time_off_type: req.type?.name || 'Time Off',
      status: req.status?.status || 'approved',
      start_date: req.start,
      end_date: req.end,
      total_days: parseFloat(req.amount?.amount || '0'),
      notes: req.notes?.[0]?.note || null,
      synced_at: new Date().toISOString()
    }
  });
}

return results.length > 0 ? results : [{ json: { _empty: true } }];
```

### Step 3: Connect to Supabase Upsert

- Operation: Upsert
- Table: `employee_time_off`
- Conflict Column: `bamboo_request_id`

### Step 4: Also Sync Employee Directory to bamboo_employees

Add a second branch to sync employees for the dropdown:
```javascript
// After getting empData
const employeeResults = empData.employees.map(emp => ({
  json: {
    bamboo_id: String(emp.id),
    first_name: emp.firstName || null,
    last_name: emp.lastName || null
  }
}));
return employeeResults;
```

Upsert to `bamboo_employees` with conflict on `bamboo_id`.

## 4. Database Schema

### employee_time_off
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| bamboo_request_id | TEXT | Unique ID from BambooHR |
| bamboo_employee_id | TEXT | Employee ID from BambooHR |
| resource_id | UUID | FK to resources (auto-linked) |
| employee_name | TEXT | Name from BambooHR |
| employee_email | TEXT | Email for matching |
| time_off_type | TEXT | e.g., "Vacation", "Sick Leave" |
| status | TEXT | e.g., "approved" |
| start_date | DATE | Start of time off |
| end_date | DATE | End of time off |
| total_days | DECIMAL | Duration (supports half days) |
| notes | TEXT | Optional notes |
| synced_at | TIMESTAMPTZ | Last sync time |

### bamboo_employees
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| bamboo_id | TEXT | BambooHR employee ID (unique) |
| first_name | TEXT | First name |
| last_name | TEXT | Last name |

### resources (added column)
| Column | Type | Description |
|--------|------|-------------|
| bamboo_employee_id | TEXT | Links to bamboo_employees.bamboo_id |

## 5. Files Created/Modified

### New Files
- `supabase/migrations/20260125_add_bamboo_employee_id.sql`
- `supabase/migrations/20260125_create_employee_time_off.sql`
- `supabase/migrations/20260125_create_bamboo_employees.sql`
- `n8n/bamboo-time-off-sync.json`
- `src/hooks/useTimeOff.ts`
- `src/hooks/useBambooEmployees.ts`
- `src/components/EmployeeTimeOffList.tsx`

### Modified Files
- `src/types/index.ts` - Added EmployeeTimeOff, BambooEmployee types
- `src/components/Dashboard.tsx` - Added timeOff to DailyHoursChart
- `src/components/atoms/charts/DailyHoursChart.tsx` - Time-off reduces expected
- `src/components/EmployeeEditorModal.tsx` - BambooHR User dropdown
- `src/components/pages/HolidaysPage.tsx` - Added time-off list and calendar integration
- `src/components/HolidayCalendar.tsx` - Shows time-off days in success-light
- `src/hooks/useResources.ts` - Handles bamboo_employee_id updates
- `src/hooks/useEmployeeTableEntities.ts` - Includes bamboo_employee_id

## 6. Test Data

```sql
-- Test bamboo employees
INSERT INTO bamboo_employees (bamboo_id, first_name, last_name)
VALUES
  ('bamboo-kalin', 'Kalin', 'Test'),
  ('bamboo-john', 'John', 'Smith'),
  ('bamboo-jane', 'Jane', 'Doe');

-- Test time-off records
INSERT INTO employee_time_off (bamboo_request_id, bamboo_employee_id, employee_name, time_off_type, status, start_date, end_date, total_days)
VALUES
  ('test-kalin-001', 'bamboo-kalin', 'Kalin Test', 'Vacation', 'approved', '2026-01-23', '2026-01-23', 1.0),
  ('test-kalin-002', 'bamboo-kalin', 'Kalin Test', 'Vacation', 'approved', '2026-01-26', '2026-01-26', 1.0),
  ('test-john-001', 'bamboo-john', 'John Smith', 'Vacation', 'approved', '2026-01-27', '2026-01-28', 2.0),
  ('test-jane-001', 'bamboo-jane', 'Jane Doe', 'PTO', 'approved', '2026-01-30', '2026-01-31', 2.0);
```

---

**Created:** 2026-01-25
**Last Updated:** 2026-01-25
**Blocked By:** BambooHR API Key (HR admin access needed)
