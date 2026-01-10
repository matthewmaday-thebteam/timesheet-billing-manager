# Timesheet & Billing Manager - Connection Guide

## System Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Clockify     │────▶│    Supabase     │────▶│   Dashboard     │
│  (Time Source)  │     │   (Database)    │     │    (Vercel)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │
                              ▼
                    timesheet_daily_rollups
```

---

## 1. Supabase Connection

### 1.1 Project Details
| Property | Value |
|----------|-------|
| Project ID | `yptbnsegcfpizwhipeep` |
| Project URL | `https://yptbnsegcfpizwhipeep.supabase.co` |
| Dashboard | https://supabase.com/dashboard/project/yptbnsegcfpizwhipeep |
| Region | (Check Supabase dashboard) |

### 1.2 Authentication
| Key Type | Usage | Security |
|----------|-------|----------|
| Service Role Key | Used by dashboard | Full database access, keep secret |
| Anon/Public Key | Not used | Would require RLS policies |

### 1.3 Environment Variables
```env
VITE_SUPABASE_URL=https://yptbnsegcfpizwhipeep.supabase.co
VITE_SUPABASE_KEY=<service_role_key>
```

### 1.4 Client Configuration
**File**: `src/lib/supabase.ts`
```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);
```

---

## 2. Database Schema

### 2.1 Table: `timesheet_daily_rollups`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | No | Primary key (auto-generated) |
| `clockify_workspace_id` | text | No | Clockify workspace identifier |
| `work_date` | date | No | Date of work |
| `project_id` | text | Yes | Clockify project ID |
| `project_name` | text | No | Project display name |
| `user_id` | text | Yes | Clockify user ID |
| `user_name` | text | No | User display name |
| `task_id` | text | Yes | Clockify task ID |
| `task_name` | text | No | Task display name (default: "No Task") |
| `total_minutes` | integer | No | Total minutes worked |
| `synced_at` | timestamptz | No | When record was synced |
| `project_key` | text | Yes | Project grouping key |
| `user_key` | text | Yes | User grouping key |
| `task_key` | text | Yes | Task grouping key |

### 2.2 Table: `timesheet_sync_runs`
(Currently empty - tracks sync operations)

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `clockify_workspace_id` | text | Workspace synced |
| `range_start` | timestamptz | Sync range start |
| `range_end` | timestamptz | Sync range end |
| `run_at` | timestamptz | When sync ran |
| `status` | text | Success/failure |
| `error` | text | Error message if failed |

### 2.3 Sample Query
```sql
SELECT *
FROM timesheet_daily_rollups
WHERE work_date >= '2026-01-01'
  AND work_date <= '2026-01-31'
ORDER BY work_date DESC;
```

---

## 3. Vercel Deployment

### 3.1 Project Details
| Property | Value |
|----------|-------|
| Project Name | timesheet-billing-manager |
| Production URL | https://timesheet-billing-manager.vercel.app |
| Framework | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |

### 3.2 Environment Variables (Vercel)
Set in Vercel Dashboard → Project Settings → Environment Variables:

| Variable | Environment | Sensitive |
|----------|-------------|-----------|
| `VITE_SUPABASE_URL` | Production | No |
| `VITE_SUPABASE_KEY` | Production | Yes |

### 3.3 Deployment Commands
```bash
# Deploy to production
vercel --prod

# Check deployment logs
vercel logs <deployment-url>

# List environment variables
vercel env ls
```

---

## 4. Data Flow

### 4.1 Clockify → Supabase
```
1. Clockify tracks time entries
2. External sync process (not in this repo) aggregates daily
3. Aggregated data written to timesheet_daily_rollups
4. Each row = one user + one project + one task + one day
```

### 4.2 Supabase → Dashboard
```
1. User opens dashboard
2. Dashboard calls useTimesheetData hook
3. Hook queries Supabase with date range filter
4. Raw entries returned
5. Client-side aggregation into hierarchy
6. UI renders project → resource → task tree
```

### 4.3 Query Pattern
**File**: `src/hooks/useTimesheetData.ts`
```typescript
const { data, error } = await supabase
  .from('timesheet_daily_rollups')
  .select('*')
  .gte('work_date', startDate)
  .lte('work_date', endDate)
  .order('work_date', { ascending: false });
```

---

## 5. API Reference

### 5.1 Supabase REST API
Base URL: `https://yptbnsegcfpizwhipeep.supabase.co/rest/v1`

**Headers Required**:
```
apikey: <service_role_key>
Authorization: Bearer <service_role_key>
```

**Example: Get January 2026 Data**
```bash
curl "https://yptbnsegcfpizwhipeep.supabase.co/rest/v1/timesheet_daily_rollups?work_date=gte.2026-01-01&work_date=lte.2026-01-31" \
  -H "apikey: <key>" \
  -H "Authorization: Bearer <key>"
```

### 5.2 Supabase JS Client
```typescript
// Select with filters
const { data } = await supabase
  .from('timesheet_daily_rollups')
  .select('*')
  .gte('work_date', '2026-01-01')
  .lte('work_date', '2026-01-31');

// Select specific columns
const { data } = await supabase
  .from('timesheet_daily_rollups')
  .select('user_name, project_name, total_minutes');

// Count records
const { count } = await supabase
  .from('timesheet_daily_rollups')
  .select('*', { count: 'exact', head: true });
```

---

## 6. Troubleshooting

### 6.1 Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Missing Supabase environment variables" | Env vars not set | Check `.env` file or Vercel settings |
| Empty dashboard | No data in date range | Verify data exists in Supabase |
| CORS errors | Invalid API key | Verify service role key is correct |
| Stale data | Clockify not synced | Check sync process status |

### 6.2 Verify Supabase Connection
```bash
# Test API connection
curl -s "https://yptbnsegcfpizwhipeep.supabase.co/rest/v1/timesheet_daily_rollups?limit=1" \
  -H "apikey: <key>" \
  -H "Authorization: Bearer <key>"
```

### 6.3 Check Vercel Logs
```bash
vercel logs https://timesheet-billing-manager.vercel.app --follow
```

---

## 7. Security Considerations

### 7.1 Current Security Model
- **No authentication**: Dashboard is publicly accessible
- **Service role key**: Embedded in client-side code
- **Acceptable for**: Internal tools, trusted networks

### 7.2 Recommendations for Production
1. Add authentication (Supabase Auth or simple password)
2. Use anon key with Row Level Security (RLS) policies
3. Restrict CORS origins in Supabase settings
4. Consider IP allowlisting if possible

### 7.3 Key Rotation
If service role key is compromised:
1. Go to Supabase Dashboard → Settings → API
2. Regenerate service role key
3. Update in Vercel environment variables
4. Redeploy: `vercel --prod`

---

## 8. Local Development

### 8.1 Setup
```bash
# Clone repository
git clone <repo-url>
cd timesheet-billing-manager

# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env with your Supabase credentials

# Start dev server (if needed)
npm run dev
```

### 8.2 Environment File
Create `.env` in project root:
```env
VITE_SUPABASE_URL=https://yptbnsegcfpizwhipeep.supabase.co
VITE_SUPABASE_KEY=your_service_role_key_here
```

### 8.3 Build & Deploy
```bash
# Type check
npx tsc --noEmit

# Build
npm run build

# Deploy to Vercel
vercel --prod
```
