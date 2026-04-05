# Task: Billings Page + Revenue Page Integration

**Stack:** Supabase/Postgres + Vite + Vercel

---

## Goal

Add a Billings module to capture:
- Fixed-fee project milestones (optionally linked to a project)
- Standalone revenue not tied to timesheets

Include these amounts in the Revenue page totals and company line items **without changing any existing timesheet-based revenue calculations**.

---

## Hard Rules (Calculation Safety)

1. **Only Transactions carry money.** Billings are containers.
2. **No double counting.** Each transaction amount contributes once.
3. **Timesheet revenue logic stays unchanged.** Billings add extra lines only.
4. **Filtering is month-range based** using `transaction_month` (normalized to first of month).
5. **Money handling must be safe:**
   - Postgres stores `BIGINT amount_cents`
   - App uses integer cents for all arithmetic
   - **Never store or compute money using float**

---

## Terminology (Canonical)

| Term | Description |
|------|-------------|
| **Company** | Tier 1 |
| **Billing** | Tier 2: container under company |
| **Transaction** | Tier 3: money entry |
| **Transaction Month** | Tier 4: month bucket for filtering/inclusion |
| **Billing Type** | Classification on Billing (not per transaction) |

---

## UI Requirements

### 1) Rename Page

Rename "Fixed Revenue" page to **Billings** (nav label, title, route label).

### 2) Accordion Structure (4 Tiers)

Reuse existing accordion pattern from Rates, expanded to 4 tiers:

- **Tier 1:** Company
- **Tier 2:** Billing
- **Tier 3:** Transaction
- **Tier 4:** Transaction Month (display "MMM YYYY", stored as first-of-month date)

### 3) Billing Row Columns (Tier 2)

| Column | Source |
|--------|--------|
| Billing | `billings.name` |
| Type | `billings.type` |
| Description | `billings.description` |
| Revenue | Sum of transactions in currently selected Billings page range |
| ⋯ menu | Edit Billing |

Also show inline **Add Transaction** button.

### 4) Billings Page Range Selector

- Billings page includes a month-range selector (reuse existing atom/pattern)
- **Revenue column rule:** Sum of transactions where `transaction_month` is within the selected range

---

## Data Model (Supabase/Postgres)

### Enum

Create enum `billing_type`:
```sql
CREATE TYPE billing_type AS ENUM (
  'revenue_milestone',
  'service_fee',
  'subscription',
  'license',
  'reimbursement'
);
```

UI maps to Title Case labels.

### Tables

#### `billings`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` |
| `company_id` | uuid | NOT NULL, references `companies(id)` |
| `name` | text | NOT NULL |
| `type` | billing_type | NOT NULL |
| `description` | text | NULL |
| `linked_project_id` | uuid | NULL, references `projects(id)` |
| `created_at` | timestamptz | default `now()` |
| `updated_at` | timestamptz | default `now()` |

**Constraints:**
- If `type != 'revenue_milestone'` then `linked_project_id IS NULL`
- If `linked_project_id` is set, the linked project must belong to the same company

**Recommended:**
- `UNIQUE (company_id, name)`

#### `billing_transactions`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` |
| `billing_id` | uuid | NOT NULL, references `billings(id)` ON DELETE CASCADE |
| `transaction_month` | date | NOT NULL (normalized YYYY-MM-01) |
| `amount_cents` | bigint | NOT NULL, CHECK (`amount_cents >= 0`) |
| `description` | text | NOT NULL |
| `created_at` | timestamptz | default `now()` |
| `updated_at` | timestamptz | default `now()` |

**Indexes:**
- `(transaction_month)`
- `(billing_id, transaction_month)`

### Triggers / DB Enforcement

#### Normalize `transaction_month` to first-of-month on insert/update:
```sql
transaction_month = date_trunc('month', transaction_month)::date
```

#### Validate milestone project belongs to billing company:

Trigger on `billings` insert/update:
- If `type != 'revenue_milestone'` AND `linked_project_id IS NOT NULL` → error
- If `linked_project_id IS NOT NULL`, verify `projects.company_id = billings.company_id` → else error

---

## Vite + Supabase Integration Pattern

Because this is Vite (client app), choose ONE approach and implement consistently:

### Option A (Recommended): Supabase RPC + RLS

Create RPC functions:
- `create_billing(...)`
- `update_billing(...)`
- `create_billing_transaction(...)`
- `update_billing_transaction(...)`

Enable RLS on both tables and allow only admins to write via policies.
Client calls RPCs using Supabase JS SDK.

### Option B: Vercel Serverless API

Create Vercel API routes that:
- Validate payloads (including cents parsing)
- Use Supabase Service Role key (server-side only)
- Enforce admin authorization based on session

Client calls `/api/...` endpoints.

**Note:** Follow existing codebase conventions if already established.

---

## Input Parsing (Money)

UI amount input is a string. Convert to cents safely (no float math):

| Input | Output (cents) |
|-------|----------------|
| `"1234"` | `123400` |
| `"1234.5"` | `123450` |
| `"1234.56"` | `123456` |
| `"12.345"` | **REJECT** (>2 decimals) |

Rules:
- Strip commas/spaces
- Allow max 2 decimals
- Reject invalid characters
- Store cents as bigint

---

## Behavior

### Create Billing (Add Button)

**Location:** Add button left of Export CSV

**Modal fields:**
- Company (required)
- Billing Name (required)
- Billing Type (required)
- Billing Description (optional)
- If Revenue Milestone: Linked Project dropdown (optional), filtered to projects under selected company

**On save:** Insert billing; show under company accordion.

### Add Transaction (Inline)

**Modal fields:**
- Transaction Month (month/year picker atom) → normalized first-of-month
- Amount (string → cents)
- Transaction Description

**On save:** Insert transaction; list under billing grouped by month.

### Edit Billing (⋯ Menu)

- Edit name/type/description
- If changing type away from milestone → clear `linked_project_id`
- Editing billing never edits existing transaction amounts

---

## Revenue Page Integration

### New Line Items

Under each company on Revenue page, add subsection **Billings** listing transactions within selected revenue range.

**Inclusion rule:** Include transactions where `transaction_month` is in range.

### Total Revenue Update

```
Revenue page Total Revenue = (existing time-based total) + (sum billing transaction cents in range)
```

All totals computed in cents.

---

## Calculation Test Cases (Must Implement)

### Test 1: Service Fee Billing
- Jan 2026: $1,000.00
- Feb 2026: $1,500.00
- **Range Jan only** → includes only $1,000.00

### Test 2: Milestone Linked to Project
- Jan milestone: $5,000.00
- Project X time-based Jan revenue: $2,000.00
- **Revenue Jan total = $7,000.00**; milestone is separate line item

### Test 3: Two Transactions Same Month
- Jan: $500.00 and $700.00
- **Sum = $1,200.00**

### Test 4: Constraint Validation
- Non-milestone cannot store `linked_project_id` (DB rejects)

---

## Design System Constraints (Hard)

1. Reuse existing atoms/molecules/patterns
2. No new components unless absolutely necessary
3. If needed: ask Matthew first, then add to Design System page

---

## Money Rule (Explicit)

| Layer | Format |
|-------|--------|
| DB | `amount_cents bigint` |
| App | Integer cents for all calculations |
| Display only | Format cents to currency string |

**Never use float for money storage or arithmetic.**
