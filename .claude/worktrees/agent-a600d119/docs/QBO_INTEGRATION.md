# QuickBooks Online Integration

## Status: Phase 1 & 2 Complete, Phase 3 Pending

**Last updated:** 2026-03-30

---

## Architecture Overview

```
Manifest App (React)
  └── useQBOConnection hook → checks qbo_oauth_tokens table
  └── useQBOCustomerMappings hook → reads/writes qbo_customer_mappings table
  └── Company Edit Modal → QBO customer dropdown (mapping)
  └── EOM Reports Page → Connect/Disconnect UI, Send to QB buttons

Supabase Edge Functions (Deno)
  └── qbo-auth-start → returns Intuit OAuth URL (admin-only, CSRF state)
  └── qbo-auth-callback → handles Intuit redirect, exchanges code for tokens (--no-verify-jwt)
  └── qbo-customers → fetches active customers from QBO API (admin-only, --no-verify-jwt)

Supabase Database
  └── qbo_oauth_tokens → stores access/refresh tokens, realm_id
  └── qbo_oauth_state → temporary CSRF state (auto-cleaned)
  └── qbo_customer_mappings → links company_id to qbo_customer_id/name
```

---

## Phase 1: OAuth Flow (COMPLETE)

### Files Created
- `supabase/migrations/068_create_qbo_oauth_tokens.sql`
- `supabase/functions/qbo-auth-start/index.ts`
- `supabase/functions/qbo-auth-callback/index.ts`
- `supabase/functions/_shared/qbo-token.ts` (reference only — inlined into each function due to Supabase bundling limitation)
- `src/hooks/useQBOConnection.ts`
- `src/types/index.ts` — added `QBOConnectionStatus`

### Files Modified
- `src/components/pages/EOMReportsPage.tsx` — Connect/Disconnect UI in header

### Secrets Required
- `QUICKBOOKS_DEV_CLIENTID` — from Intuit developer portal
- `QUICKBOOKS_DEV_SECRET` — from Intuit developer portal
- `QUICKBOOKS_DEV_REDIRECT` — must match `https://yptbnsegcfpizwhipeep.supabase.co/functions/v1/qbo-auth-callback`
- `APP_BASE_URL` — set to `https://manifest.yourbteam.com`

### Key Design Decisions
- Tokens stored in `qbo_oauth_tokens` with service_role-only write access
- Authenticated users can SELECT safe columns only (realm_id, expires_at, refresh_expires_at)
- CSRF protection via `qbo_oauth_state` table with 10-minute expiry
- `qbo-auth-callback` deployed with `--no-verify-jwt` (browser redirect, no auth header possible)
- Admin-only gate on `qbo-auth-start` via `is_admin` RPC

### Token Refresh
- `getValidToken()` utility checks token expiry with 5-minute buffer
- Auto-refreshes via Intuit's token endpoint if near expiry
- Must be **inlined** into each Edge Function (Supabase doesn't resolve `_shared/` imports during remote bundling)

---

## Phase 2: Customer Mapping (COMPLETE)

### Files Created
- `supabase/migrations/069_create_qbo_customer_mappings.sql`
- `supabase/functions/qbo-customers/index.ts`
- `src/hooks/useQBOCustomerMappings.ts`
- `src/types/index.ts` — added `QBOCustomer`, `QBOCustomerMapping`

### Files Modified
- `src/components/CompanyEditorModal.tsx` — QBO customer dropdown in company edit form
- `src/components/pages/EOMReportsPage.tsx` — removed mapping modal, Send to QB button visibility

### How Mapping Works
- Company Management → Edit a company → "QuickBooks Customer" dropdown appears when QB is connected
- Select a QBO customer from the dropdown → saved on form save
- `qbo_customer_mappings` table: `company_id` (UNIQUE) → `qbo_customer_id` + `qbo_customer_name`
- EOM Reports page checks `mappedCompanyIds` to show/hide Send to QB buttons

### Deployment Notes
- `qbo-customers` deployed with `--no-verify-jwt` (has its own auth + admin check internally)
- QBO API URL defaults to sandbox: `sandbox-quickbooks.api.intuit.com`
- Set `QBO_API_BASE` secret to switch to production: `https://quickbooks.api.intuit.com/v3/company`

---

## Phase 3: Invoice Generation (NOT STARTED)

### Goal
Enable the "Send to QB" buttons to create invoices in QuickBooks from EOM report data.

### Planned Files
| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/070_create_qbo_invoice_log.sql` | CREATE | Track sent invoices, prevent duplicates |
| `supabase/functions/qbo-create-invoice/index.ts` | CREATE | Build and POST invoice to QBO API |
| `src/hooks/useQBOInvoices.ts` | CREATE | Send invoices, track status |
| `src/types/index.ts` | EDIT | Add `QBOInvoiceLogEntry` type |
| `src/components/pages/EOMReportsPage.tsx` | EDIT | Enable Send to QB buttons with states |

### Database: `qbo_invoice_log`
```sql
CREATE TABLE qbo_invoice_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    eom_report_id       UUID REFERENCES eom_reports(id) ON DELETE SET NULL,
    company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    report_year         INTEGER NOT NULL,
    report_month        INTEGER NOT NULL,
    qbo_customer_id     TEXT NOT NULL,
    qbo_invoice_id      TEXT,              -- returned from QBO on success
    invoice_number      TEXT,              -- QBO DocNumber
    total_amount_cents  BIGINT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'sent', 'error'
    error_message       TEXT,
    sent_at             TIMESTAMPTZ,
    sent_by             UUID REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_qbo_invoice_company_month UNIQUE(company_id, report_year, report_month)
);
```
- UNIQUE constraint on `(company_id, report_year, report_month)` prevents duplicate invoices
- Once sent, stays sent (no re-send for MVP)

### Edge Function: `qbo-create-invoice`
- POST body: `{ companyId, year, month }`
- Queries same source data as `generate-eom-report` (NOT the CSV)
- Uses `getValidToken()` (inlined) for QBO auth
- Must query QBO for a Service-type Item to use as ItemRef
- Creates one invoice per company per month

### QBO Invoice Payload Structure
```json
{
  "CustomerRef": { "value": "<qbo_customer_id>" },
  "TxnDate": "2026-02-28",
  "PrivateNote": "Manifest EOM Report - February 2026",
  "Line": [
    {
      "Amount": 12500.00,
      "Description": "Project Alpha - 100.00 hrs @ $125.00/hr",
      "DetailType": "SalesItemLineDetail",
      "SalesItemLineDetail": {
        "ItemRef": { "value": "<service_item_id>", "name": "Services" },
        "Qty": 100.00,
        "UnitPrice": 125.00
      }
    }
  ]
}
```

### Line Item Mapping
- Each **project** billed that month → one invoice line item (hours x rate)
- Each **fixed billing** (milestone, subscription, etc.) → one invoice line item (qty 1 x amount)
- `TxnDate` = last day of the report month

### ItemRef Strategy
- Query QBO for first active Service-type item at invoice creation time
- `SELECT Id, Name FROM Item WHERE Type = 'Service' AND Active = true MAXRESULTS 1`
- If none exists, return error telling user to create a Service item in QBO

### UI: Send to QB Button States
| State | Condition | Appearance |
|-------|-----------|------------|
| Hidden | QB not connected OR company not mapped | Not rendered |
| Ready | Mapped + report generated + not yet sent | Enabled, variant="secondary" |
| Sending | API call in progress | Disabled + Spinner |
| Sent | Invoice logged in qbo_invoice_log | Disabled + Badge "Sent" with invoice # |
| Error | Last attempt failed | Enabled (retry) + error indicator |

### React Hook: `useQBOInvoices`
- Fetches `qbo_invoice_log` on mount
- `sendInvoice(companyId, year, month)` → calls Edge Function
- `sendAllForMonth(year, month, companyIds[])` → sequential sends (avoid rate limits)
- Tracks `sendingCompanies` Set for loading states
- `getInvoiceStatus(companyId, year, month)` → lookup from log

### RLS Notes (from Phase 1/2 lessons)
- Grant `authenticated` SELECT on `qbo_invoice_log` (frontend needs to check sent status)
- Writes via Edge Function with service_role
- Deploy with `--no-verify-jwt` (function does its own auth internally)
- Remember to inline `getValidToken()` — do NOT use `_shared/` import

---

## Going to Production

When ready to switch from sandbox to production QBO:

1. In Intuit developer portal: create production keys (or switch app to production)
2. Update Supabase secrets:
   ```bash
   supabase secrets set QUICKBOOKS_DEV_CLIENTID=<production_client_id>
   supabase secrets set QUICKBOOKS_DEV_SECRET=<production_secret>
   supabase secrets set QUICKBOOKS_DEV_REDIRECT=https://yptbnsegcfpizwhipeep.supabase.co/functions/v1/qbo-auth-callback
   supabase secrets set QBO_API_BASE=https://quickbooks.api.intuit.com/v3/company
   ```
3. Re-authorize: Disconnect QB in the app, then reconnect (gets new production tokens)
4. Re-map customers (production QBO has different customer IDs than sandbox)

---

## Known Issues / Tech Debt

1. **`_shared/` imports don't work** — Supabase Edge Functions can't resolve relative imports to `_shared/` during remote bundling. `getValidToken()` must be inlined into each function that needs it. The `_shared/qbo-token.ts` file exists as a reference but is not used.
2. **No pagination on QBO customer fetch** — `qbo-customers` fetches max 1000 customers. Fine for current use; add pagination if needed.
3. **`SELECT *` in QBO customer query** — Fetches all fields when only 4 are needed. Could optimize to `SELECT Id, DisplayName, CompanyName, PrimaryEmailAddr`.
4. **Secret naming** — Using `QUICKBOOKS_DEV_*` prefix for both dev and prod. Consider renaming to `QUICKBOOKS_*` when going to production.
