# Task 049: AI Agent — Under-Hours Email Conversation

## Status: Pending

## Depends On

- **Task 048** (N8N Monday Neocurrency Report) — establishes email sending infrastructure, N8N → Supabase Edge Function pattern, and cron scheduling.

---

## Problem

When an employee logs fewer hours than expected for a given day, someone has to manually notice and follow up. There are three common explanations, each with a different action:

1. **Sick / out of office** → HR needs to know so they can add the sick day
2. **No work assigned** → The employee's direct report and the company owners need to know
3. **Forgot to log / mechanical issue** → The employee just needs a nudge to correct it

Currently this follow-up doesn't happen systematically. Hours go missing and nobody knows why until the monthly review.

---

## Solution

An AI agent that runs every weekday morning, detects employees who were under expected hours the previous working day, and initiates a natural email conversation. Based on the employee's reply, the agent classifies the reason and routes the outcome to the right people — all automatically.

### Conversation Flow

```
┌──────────────────────────────────────────────────────────┐
│  DAILY CRON (weekday mornings, e.g. 9:00 AM)             │
│                                                           │
│  1. Query previous working day's hours per employee       │
│  2. Subtract holidays and approved time-off               │
│  3. Compare against daily expected threshold              │
│  4. For each under-hours employee → send outreach email   │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│  OUTREACH EMAIL (natural, friendly tone)                  │
│                                                           │
│  "Hey Kalin,                                              │
│                                                           │
│   I noticed you logged 2.5 hours yesterday (we'd          │
│   normally expect around 8). No worries at all — just     │
│   wanted to check in. Was everything okay?                │
│                                                           │
│   Just reply to this email and let me know what           │
│   happened, and I'll take care of the rest."              │
└────────────────────────┬─────────────────────────────────┘
                         │
                    employee replies
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│  INBOUND EMAIL → N8N TRIGGER                              │
│                                                           │
│  Parse reply, match to conversation, extract body text    │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│  AI CLASSIFICATION (Anthropic Claude API)                  │
│                                                           │
│  System prompt: Classify the employee's response into     │
│  exactly one of three categories:                         │
│                                                           │
│  1. SICK_OR_ABSENT — was sick, had appointment, out       │
│  2. NO_WORK_AVAILABLE — nothing assigned, idle            │
│  3. FORGOT_OR_ERROR — forgot to log, system issue         │
│                                                           │
│  Also extract a brief summary of what they said.          │
└───────┬──────────────────┬──────────────────┬────────────┘
        │                  │                  │
        ▼                  ▼                  ▼
   SICK_OR_ABSENT    NO_WORK_AVAILABLE   FORGOT_OR_ERROR
        │                  │                  │
        ▼                  ▼                  ▼
┌──────────────┐  ┌────────────────┐  ┌─────────────────┐
│ Email HR:    │  │ Email direct   │  │ Reply to         │
│ "Kalin was   │  │ report +       │  │ employee:        │
│ sick on      │  │ owners:        │  │ "No problem!     │
│ Feb 16,      │  │ "Kalin had no  │  │ Just update your │
│ please add   │  │ assigned work  │  │ hours when you   │
│ a sick day"  │  │ on Feb 16"     │  │ get a chance."   │
└──────────────┘  └────────────────┘  └─────────────────┘
```

---

## Architecture

### N8N Workflow (7 nodes)

```
┌────────┐   ┌───────────┐   ┌──────────┐   ┌──────────┐
│ Cron   │──▶│ Edge Fn:  │──▶│ Filter   │──▶│ Send     │
│ 9:00AM │   │ detect    │   │ already  │   │ outreach │
│ M-F    │   │ under-hrs │   │ contacted│   │ emails   │
└────────┘   └───────────┘   └──────────┘   └──────────┘

┌────────────┐   ┌───────────┐   ┌──────────┐
│ Inbound    │──▶│ Edge Fn:  │──▶│ Route    │
│ Email      │   │ classify  │   │ emails   │
│ Trigger    │   │ + record  │   │ by type  │
└────────────┘   └───────────┘   └──────────┘
```

Two separate N8N workflows:
1. **Outreach workflow** — cron-triggered, sends initial emails
2. **Response workflow** — email-triggered, processes replies

### Supabase Edge Functions (2 new)

1. **`detect-under-hours`** — queries yesterday's data, returns list of under-hours employees
2. **`classify-response`** — receives reply text, calls Anthropic API, classifies, records outcome, returns routing instructions

### New Database Tables (3)

1. **`under_hours_conversations`** — tracks each conversation instance
2. **`org_contacts`** — maps roles (HR, manager, owner) to email addresses
3. **`notification_config`** — thresholds and settings

---

## Step 1: Database Migration

**New file:** `supabase/migrations/XXX_under_hours_agent.sql`

### Table: `under_hours_conversations`

Tracks each AI conversation from outreach through resolution.

```sql
CREATE TABLE public.under_hours_conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  resource_id UUID NOT NULL REFERENCES public.resources(id),
  resource_email TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  work_date DATE NOT NULL,                         -- the date they were under hours
  actual_hours NUMERIC(5,2) NOT NULL,              -- hours they logged
  expected_hours NUMERIC(5,2) NOT NULL,            -- hours expected
  deficit_hours NUMERIC(5,2) NOT NULL,             -- expected - actual

  -- Outreach
  outreach_sent_at TIMESTAMPTZ,                    -- when the initial email was sent
  outreach_message_id TEXT,                         -- email service message ID (for reply matching)

  -- Response
  employee_reply TEXT,                              -- raw reply text
  employee_replied_at TIMESTAMPTZ,

  -- Classification
  classification TEXT CHECK (classification IN (
    'sick_or_absent', 'no_work_available', 'forgot_or_error'
  )),
  classification_summary TEXT,                      -- AI-generated brief summary
  classified_at TIMESTAMPTZ,

  -- Routing
  routed_to TEXT[],                                 -- email addresses notified
  routing_sent_at TIMESTAMPTZ,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',          -- detected, not yet emailed
    'outreach_sent',    -- initial email sent, awaiting reply
    'reply_received',   -- employee replied, awaiting classification
    'classified',       -- classified, routing email sent
    'resolved',         -- complete
    'expired'           -- no reply after X days
  )),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate outreach for same employee + date
  UNIQUE(resource_id, work_date)
);

-- Index for the inbound email lookup (match reply to conversation)
CREATE INDEX idx_uhc_message_id ON under_hours_conversations(outreach_message_id)
  WHERE outreach_message_id IS NOT NULL;

-- Index for pending/active conversations
CREATE INDEX idx_uhc_status ON under_hours_conversations(status)
  WHERE status NOT IN ('resolved', 'expired');
```

### Table: `org_contacts`

Maps organizational roles to email addresses. This is needed because the current schema has no manager relationship or owner designation.

```sql
CREATE TABLE public.org_contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN (
    'hr',               -- head of HR
    'owner',            -- company owner (may have multiple)
    'manager'           -- direct manager for a specific resource
  )),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  resource_id UUID REFERENCES public.resources(id),  -- NULL for global roles (hr, owner)
                                                      -- set for per-resource roles (manager)
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- A resource can have at most one manager
  UNIQUE(role, resource_id) WHERE role = 'manager'
);

-- Seed with initial contacts (update emails before deploying)
INSERT INTO org_contacts (role, email, display_name) VALUES
  ('hr', 'hr@yourbteam.com', 'HR Contact'),
  ('owner', 'owner1@yourbteam.com', 'Owner 1'),
  ('owner', 'owner2@yourbteam.com', 'Owner 2');

-- Example manager mapping:
-- INSERT INTO org_contacts (role, email, display_name, resource_id) VALUES
--   ('manager', 'manager@client.com', 'PM Name', '<resource-uuid>');
```

### Table: `notification_config`

System-wide settings for the AI agent.

```sql
CREATE TABLE public.notification_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO notification_config (key, value, description) VALUES
  ('under_hours_threshold', '2.0',
   'Minimum deficit (hours) to trigger outreach. Employees under by less than this are ignored.'),
  ('daily_expected_hours', '{"full_time": 8, "part_time": 4}',
   'Expected hours per day by employment type. Contractors/vendors are excluded.'),
  ('reply_expiry_days', '3',
   'Days to wait for a reply before marking conversation as expired.'),
  ('sender_email', '"manifest-assistant@yourbteam.com"',
   'From address for outreach emails.'),
  ('sender_name', '"Manifest Assistant"',
   'Display name for outreach emails.');
```

---

## Step 2: Edge Function — `detect-under-hours`

**New file:** `supabase/functions/detect-under-hours/index.ts`

Called by N8N every weekday morning. Returns a list of employees who were under expected hours the previous working day.

### Request

```
POST /functions/v1/detect-under-hours
Authorization: Bearer <service_role_key>
Content-Type: application/json

{
  "date": "2026-02-16"    // optional, defaults to previous working day
}
```

### Internal Logic

1. **Determine the check date:**
   - If not provided, calculate the previous working day (skip weekends)
   - If Monday, check Friday

2. **Exclude holidays:**
   ```sql
   SELECT 1 FROM bulgarian_holidays
   WHERE holiday_date = :checkDate;
   ```
   If the check date is a holiday, return empty list (no one expected to work).

3. **Get approved time-off for the check date:**
   ```sql
   SELECT resource_id FROM employee_time_off
   WHERE :checkDate BETWEEN start_date AND end_date
     AND status = 'approved';
   ```
   Employees on approved time-off are excluded.

4. **Get hours per employee for the check date:**
   ```sql
   SELECT
     r.id AS resource_id,
     r.email,
     COALESCE(r.first_name || ' ' || r.last_name, ve.user_name) AS display_name,
     et.name AS employment_type,
     COALESCE(SUM(ve.total_minutes), 0) / 60.0 AS actual_hours
   FROM resources r
   JOIN employment_types et ON et.id = r.employment_type_id
   LEFT JOIN v_timesheet_entries ve
     ON ve.user_name = r.external_label
     AND ve.work_date = :checkDate
   WHERE et.name IN ('Full-time', 'Part-time')
     AND r.id NOT IN (SELECT resource_id FROM employee_time_off
                       WHERE :checkDate BETWEEN start_date AND end_date
                       AND status = 'approved')
   GROUP BY r.id, r.email, r.first_name, r.last_name, ve.user_name, et.name;
   ```

5. **Calculate deficit:**
   ```typescript
   const expectedHours = config.daily_expected_hours[employmentType]; // 8 or 4
   const deficit = expectedHours - actualHours;
   ```

6. **Filter by threshold:**
   Only include employees where `deficit >= notification_config.under_hours_threshold` (default: 2.0 hours).

7. **Exclude already-contacted:**
   ```sql
   SELECT resource_id FROM under_hours_conversations
   WHERE work_date = :checkDate
     AND status NOT IN ('expired');
   ```

8. **Create conversation records** for each under-hours employee:
   ```sql
   INSERT INTO under_hours_conversations
     (resource_id, resource_email, resource_name, work_date, actual_hours, expected_hours, deficit_hours, status)
   VALUES ...
   ON CONFLICT (resource_id, work_date) DO NOTHING
   RETURNING *;
   ```

### Response

```json
{
  "checkDate": "2026-02-16",
  "wasHoliday": false,
  "underHoursEmployees": [
    {
      "conversationId": "uuid",
      "resourceId": "uuid",
      "email": "kalin@example.com",
      "displayName": "Kalin Tomanov",
      "employmentType": "Full-time",
      "actualHours": 2.5,
      "expectedHours": 8.0,
      "deficit": 5.5
    }
  ]
}
```

---

## Step 3: Edge Function — `classify-response`

**New file:** `supabase/functions/classify-response/index.ts`

Called by N8N when an inbound reply email is received. Uses the Anthropic API (same pattern as the existing `chat` edge function) to classify the response.

### Request

```
POST /functions/v1/classify-response
Authorization: Bearer <service_role_key>
Content-Type: application/json

{
  "conversationId": "uuid",
  "replyText": "Yeah I was feeling terrible yesterday, stayed home sick"
}
```

### Internal Logic

1. **Load conversation record** from `under_hours_conversations`

2. **Call Anthropic API** with classification prompt:

   ```typescript
   const systemPrompt = `You are classifying an employee's response about why they logged fewer hours than expected on a workday. The employee was asked a friendly question about their missing hours.

   Classify the response into exactly ONE of these categories:

   1. SICK_OR_ABSENT — The employee was sick, had a medical appointment, had a personal emergency, was out of office, or any other legitimate absence. This includes: feeling unwell, doctor visit, family emergency, bereavement, car trouble preventing them from working, etc.

   2. NO_WORK_AVAILABLE — The employee wanted to work but had nothing assigned. This includes: waiting for tasks, between projects, blocked by dependencies, no client work available, manager didn't assign anything, etc.

   3. FORGOT_OR_ERROR — The employee worked but forgot to log hours, had a technical issue with the time tracker, logged hours to the wrong project, or plans to update their timesheet. This includes: "I'll fix it", "oops I forgot", "the system was down", "I logged it under the wrong project", etc.

   Respond with JSON only:
   {
     "classification": "sick_or_absent" | "no_work_available" | "forgot_or_error",
     "summary": "One sentence summary of what the employee said",
     "confidence": "high" | "medium" | "low"
   }

   If the response is ambiguous or doesn't fit any category, use your best judgment and set confidence to "low".`;

   const userMessage = `Employee: ${conversation.resource_name}
   Date in question: ${conversation.work_date}
   Hours logged: ${conversation.actual_hours} (expected: ${conversation.expected_hours})

   Employee's reply:
   "${replyText}"`;
   ```

3. **Update conversation record:**
   ```sql
   UPDATE under_hours_conversations SET
     employee_reply = :replyText,
     employee_replied_at = NOW(),
     classification = :classification,
     classification_summary = :summary,
     classified_at = NOW(),
     status = 'classified'
   WHERE id = :conversationId;
   ```

4. **Look up routing contacts:**
   ```sql
   -- For SICK_OR_ABSENT: get HR contacts
   SELECT email, display_name FROM org_contacts
   WHERE role = 'hr' AND is_active = true;

   -- For NO_WORK_AVAILABLE: get manager + owners
   SELECT email, display_name FROM org_contacts
   WHERE (role = 'owner' AND is_active = true)
      OR (role = 'manager' AND resource_id = :resourceId AND is_active = true);

   -- For FORGOT_OR_ERROR: no lookup needed (reply goes back to employee)
   ```

### Response

```json
{
  "conversationId": "uuid",
  "classification": "sick_or_absent",
  "summary": "Kalin was feeling unwell and stayed home sick",
  "confidence": "high",
  "routing": {
    "action": "notify_hr",
    "recipients": [
      { "email": "hr@yourbteam.com", "name": "HR Contact" }
    ],
    "employeeEmail": "kalin@example.com",
    "employeeName": "Kalin Tomanov",
    "workDate": "2026-02-16",
    "suggestedSubject": "Sick Day — Kalin Tomanov — Feb 16",
    "suggestedBody": "Hi,\n\nKalin Tomanov was sick on February 16 and was unable to work. Could you please add a sick day for that date?\n\nSummary: Kalin was feeling unwell and stayed home sick.\n\nThis was reported via the automated hours check-in system.\n\nBest,\nManifest Assistant"
  }
}
```

For `NO_WORK_AVAILABLE`:
```json
{
  "routing": {
    "action": "notify_manager_and_owners",
    "recipients": [
      { "email": "pm@client.com", "name": "PM Name" },
      { "email": "owner@yourbteam.com", "name": "Owner" }
    ],
    "suggestedSubject": "No Work Available — Kalin Tomanov — Feb 16",
    "suggestedBody": "Hi,\n\nKalin Tomanov reported that they had no assigned work on February 16. They logged 2.5 hours against an expected 8.0 hours.\n\nSummary: Kalin said there were no tasks assigned to them and they were waiting for direction.\n\nPlease follow up to ensure they have work assigned going forward.\n\nBest,\nManifest Assistant"
  }
}
```

For `FORGOT_OR_ERROR`:
```json
{
  "routing": {
    "action": "encourage_employee",
    "recipients": [
      { "email": "kalin@example.com", "name": "Kalin Tomanov" }
    ],
    "suggestedSubject": "Re: Hours check-in for Feb 16",
    "suggestedBody": "No worries at all! Just update your hours in Clockify when you get a chance. If you run into any issues with the system, let us know.\n\nThanks,\nManifest Assistant"
  }
}
```

---

## Step 4: N8N Workflow — Outreach (Daily Cron)

### Node 1: Schedule Trigger
- **Type:** Schedule Trigger
- **Rule:** Every weekday (Mon–Fri) at 9:00 AM

### Node 2: Call `detect-under-hours` Edge Function
- **Type:** HTTP Request
- **Method:** POST
- **URL:** `https://yptbnsegcfpizwhipeep.supabase.co/functions/v1/detect-under-hours`
- **Headers:** `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
- **Body:** `{}` (uses default — previous working day)

### Node 3: Filter — Skip if No Under-Hours
- **Type:** IF
- **Condition:** `{{ $json.underHoursEmployees.length > 0 }}`
- **False branch:** Stop (nothing to do)

### Node 4: Split — One Item Per Employee
- **Type:** Split In Batches / Loop Over Items
- **Input:** `underHoursEmployees` array

### Node 5: Generate Outreach Email (Code Node)

Uses Anthropic API to generate a natural, friendly outreach message (not a rigid template). Each email should feel personal.

```javascript
const emp = $input.first().json;
const firstName = emp.displayName.split(' ')[0];

// The prompt generates a natural email — not a template
const prompt = `Write a brief, friendly email to ${firstName} checking in about their hours yesterday. They logged ${emp.actualHours} hours when we'd normally expect about ${emp.expectedHours}.

Key rules:
- Warm, casual tone — like a helpful coworker, not a manager
- Don't be accusatory or make them feel bad
- Make it clear they can just reply to this email
- Keep it to 3-4 sentences max
- Don't use the word "concerned"
- Sign off as "Manifest Assistant"

Return ONLY the email body text, no subject line.`;

// Call Anthropic API (or use the edge function pattern)
// For simplicity, this could also be a static template:
const body = `Hey ${firstName},

I noticed you logged ${emp.actualHours} hours yesterday — we'd normally expect around ${emp.expectedHours}. No worries at all, just wanted to check in. Was everything okay?

Just reply to this email and let me know what happened, and I'll take care of the rest.

Best,
Manifest Assistant`;

return [{
  json: {
    to: emp.email,
    subject: `Hours check-in for ${emp.workDate}`,
    body: body,
    conversationId: emp.conversationId,
  }
}];
```

**Design decision:** The outreach email can be AI-generated (call Anthropic for variety) or a well-crafted static template. A static template is simpler, more predictable, and sufficient for v1. AI generation adds natural variation but requires an extra API call per employee.

### Node 6: Send Email
- **Type:** Send Email (SMTP) or Gmail/Outlook node
- **To:** `{{ $json.to }}`
- **Subject:** `{{ $json.subject }}`
- **Body:** `{{ $json.body }}`
- **From:** `manifest-assistant@yourbteam.com` (configured in notification_config)
- **Reply-To:** A dedicated inbound email address (see Step 5)
- **Important:** Capture the email `Message-ID` header from the send response

### Node 7: Update Conversation Status
- **Type:** HTTP Request (Supabase REST API)
- **Method:** PATCH
- **URL:** `https://yptbnsegcfpizwhipeep.supabase.co/rest/v1/under_hours_conversations?id=eq.{{ $json.conversationId }}`
- **Headers:** `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`, `apikey: <SUPABASE_ANON_KEY>`
- **Body:**
  ```json
  {
    "outreach_sent_at": "{{ $now.toISOString() }}",
    "outreach_message_id": "{{ $json.emailMessageId }}",
    "status": "outreach_sent"
  }
  ```

---

## Step 5: N8N Workflow — Response Handler (Email Trigger)

### Inbound Email Setup

Two options for receiving employee replies:

**Option A: Dedicated mailbox + N8N IMAP Trigger**
- Create a mailbox: `manifest-assistant@yourbteam.com`
- N8N IMAP Trigger node polls this mailbox every 1-2 minutes
- Simplest setup, works with any email provider

**Option B: Resend inbound webhook**
- Configure Resend to forward inbound emails to an N8N webhook URL
- Lower latency but requires Resend configuration
- More infrastructure to manage

**Recommended:** Option A (IMAP) for v1 simplicity.

### Node 1: Email Trigger (IMAP)
- **Type:** Email Read (IMAP) or Email Trigger
- **Mailbox:** `manifest-assistant@yourbteam.com`
- **Folder:** INBOX
- **Poll interval:** Every 2 minutes

### Node 2: Match Reply to Conversation (Code Node)

```javascript
const email = $input.first().json;
const fromEmail = email.from.text || email.from;
const replyText = email.text || email.textAsHtml || '';

// Strip quoted/forwarded content (get only the new reply)
// Common patterns: lines starting with >, "On ... wrote:", "From: ..."
const lines = replyText.split('\n');
const replyLines = [];
for (const line of lines) {
  if (line.startsWith('>') || line.match(/^On .+ wrote:$/)) break;
  if (line.match(/^From: /)) break;
  if (line.match(/^-{3,}/) && replyLines.length > 0) break;
  replyLines.push(line);
}
const cleanReply = replyLines.join('\n').trim();

return [{
  json: {
    fromEmail: fromEmail,
    replyText: cleanReply,
    rawReply: replyText,
    subject: email.subject,
  }
}];
```

### Node 3: Look Up Conversation
- **Type:** HTTP Request (Supabase REST API)
- **Method:** GET
- **URL:** `https://yptbnsegcfpizwhipeep.supabase.co/rest/v1/under_hours_conversations?resource_email=eq.{{ $json.fromEmail }}&status=eq.outreach_sent&order=created_at.desc&limit=1`
- **Purpose:** Find the most recent outreach conversation for this employee

### Node 4: Filter — Valid Conversation Found
- **Type:** IF
- **Condition:** Response has at least one record
- **False branch:** Log and skip (reply from unknown sender or no pending conversation)

### Node 5: Call `classify-response` Edge Function
- **Type:** HTTP Request
- **Method:** POST
- **URL:** `https://yptbnsegcfpizwhipeep.supabase.co/functions/v1/classify-response`
- **Headers:** `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
- **Body:**
  ```json
  {
    "conversationId": "{{ $json.conversationId }}",
    "replyText": "{{ $json.replyText }}"
  }
  ```

### Node 6: Route by Classification (Switch Node)
- **Type:** Switch
- **Field:** `{{ $json.routing.action }}`
- **Routes:**
  - `notify_hr` → Node 7A
  - `notify_manager_and_owners` → Node 7B
  - `encourage_employee` → Node 7C

### Node 7A: Email HR (Sick/Absent)
- **Type:** Send Email
- **To:** `{{ $json.routing.recipients[*].email }}`
- **Subject:** `{{ $json.routing.suggestedSubject }}`
- **Body:** `{{ $json.routing.suggestedBody }}`

### Node 7B: Email Manager + Owners (No Work Available)
- **Type:** Send Email
- **To:** `{{ $json.routing.recipients[*].email }}`
- **Subject:** `{{ $json.routing.suggestedSubject }}`
- **Body:** `{{ $json.routing.suggestedBody }}`

### Node 7C: Reply to Employee (Forgot/Error)
- **Type:** Send Email
- **To:** `{{ $json.routing.recipients[0].email }}`
- **Subject:** `{{ $json.routing.suggestedSubject }}`
- **Body:** `{{ $json.routing.suggestedBody }}`

### Node 8: Update Conversation to Resolved
- **Type:** HTTP Request (Supabase REST API)
- **Method:** PATCH
- **Body:**
  ```json
  {
    "routed_to": "{{ $json.routing.recipients.map(r => r.email) }}",
    "routing_sent_at": "{{ $now.toISOString() }}",
    "status": "resolved"
  }
  ```

---

## Step 6: Expiry Workflow (Optional — Cron)

A third N8N workflow that runs daily and expires conversations with no reply after N days.

```sql
UPDATE under_hours_conversations
SET status = 'expired', updated_at = NOW()
WHERE status = 'outreach_sent'
  AND outreach_sent_at < NOW() - INTERVAL '3 days';
```

Optionally send a summary to admins: "These employees did not respond to their hours check-in: ..."

---

## Email Address Requirements

| Address | Purpose | Setup |
|---------|---------|-------|
| `manifest-assistant@yourbteam.com` | Send outreach + receive replies | Dedicated mailbox (Google Workspace, etc.) |
| HR contact(s) | Receive sick day notifications | Configured in `org_contacts` table |
| Owner(s) | Receive "no work available" alerts | Configured in `org_contacts` table |
| Manager(s) | Receive "no work available" alerts | Configured per-resource in `org_contacts` table |

---

## Files to Create

| File | Description |
|------|-------------|
| `supabase/migrations/XXX_under_hours_agent.sql` | New tables: `under_hours_conversations`, `org_contacts`, `notification_config` |
| `supabase/functions/detect-under-hours/index.ts` | Edge function: daily detection and conversation creation |
| `supabase/functions/classify-response/index.ts` | Edge function: Anthropic classification and routing |

## Files NOT Modified

- `src/components/UnderHoursModal.tsx` — existing UI unchanged
- `src/utils/calculations.ts` — existing under-hours logic unchanged (operates monthly; this task adds daily)
- `src/components/pages/RevenuePage.tsx` — unrelated
- No frontend changes — this is entirely backend + N8N

---

## Anthropic API Usage

The `classify-response` edge function calls the Anthropic API. Follow the same pattern as the existing `chat` edge function (`supabase/functions/chat/index.ts`):

- Import: `import Anthropic from 'npm:@anthropic-ai/sdk'`
- Model: `claude-sonnet-4-5-20250929` (fast, cheap, excellent at classification)
- Max tokens: 200 (classification response is small)
- Temperature: 0 (deterministic classification)
- Expected cost: ~$0.001 per classification (negligible)

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Employee has 0 hours (didn't log at all) | Included — deficit = full expected hours |
| Employee is on approved time-off | Excluded by `employee_time_off` check |
| Check date is a Bulgarian holiday | Skip — return empty list |
| Monday morning (checking Friday) | Previous working day calculation handles this |
| Employee replies with ambiguous message | AI classifies with `confidence: low`; still routes but could flag for human review |
| Employee replies multiple times | Only first reply processed (conversation moves to `classified` status) |
| Employee replies to wrong conversation | Matched by email address to most recent `outreach_sent` conversation |
| Email bounces (invalid address) | N8N error handling; conversation stays in `outreach_sent` until expired |
| Employee has no email in `resources` table | Excluded from outreach (edge function skips null emails) |
| Multiple employees under hours same day | Each gets their own conversation record and email |

---

## Verification

- [ ] Migration creates all three tables with correct constraints
- [ ] `detect-under-hours` correctly identifies under-hours employees
- [ ] `detect-under-hours` excludes holidays, time-off, contractors/vendors
- [ ] `detect-under-hours` excludes already-contacted employees
- [ ] `classify-response` correctly classifies "I was sick" → `sick_or_absent`
- [ ] `classify-response` correctly classifies "nothing to do" → `no_work_available`
- [ ] `classify-response` correctly classifies "forgot to log" → `forgot_or_error`
- [ ] Routing emails arrive at correct recipients for each classification
- [ ] Outreach email tone is natural and non-accusatory
- [ ] Reply stripping correctly removes quoted email content
- [ ] Conversation lifecycle: pending → outreach_sent → classified → resolved
- [ ] Expiry workflow marks stale conversations after 3 days
- [ ] `org_contacts` table populated with real email addresses before go-live

### Manual Test Procedure

1. Seed `org_contacts` with test email addresses
2. Ensure at least one employee has fewer hours than expected for a recent date
3. Trigger the outreach workflow manually in N8N
4. Reply to the outreach email with each scenario:
   - "I was sick yesterday"
   - "There was nothing for me to work on"
   - "Oh I forgot to log my hours"
5. Verify correct routing email arrives for each case
6. Check `under_hours_conversations` table for correct state transitions

---

## Future Enhancements

- **Follow-up conversations:** If the AI isn't confident in classification, ask a clarifying question before routing
- **Weekly digest:** Summary email to owners/HR showing all conversations and outcomes for the week
- **Threshold learning:** Adjust per-employee thresholds based on historical patterns
- **In-app dashboard:** View conversation history and outcomes in the Manifest UI
- **Multi-language support:** Outreach in employee's preferred language (relevant for Bulgarian team)
- **Slack/Teams integration:** Alternative to email for employees who prefer chat
