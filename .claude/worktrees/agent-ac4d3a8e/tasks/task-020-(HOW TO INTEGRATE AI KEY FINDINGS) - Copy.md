# Task 020: On-Demand “Insights” Table (Real-time Observations) + Guardrails

**Status:** PENDING

**Depends on:** Task 014/015 (tokens + core components), Task 017 (lint/CI enforcement) recommended

**Priority:** High - Introduces data-driven AI insights while maintaining safety and consistency

---

## 1. Problem Statement

We want the dashboard to provide **on-demand insights**: novel, actionable observations computed from the **current database state** at request time (not precomputed reports). These insights must be:

- **Token-consistent** (UI uses design system components/tokens)
- **Safe** (no exposing PII, no uncontrolled DB access)
- **Auditable** (insights include evidence derived from tool outputs)
- **Guardrailed** (deterministic structure, limited scope, rate-limited)

The dashboard should add a new **Insights Table** between:
- Row 1: Date Range Selector
- Row 2: (Charts row, if present)
- Row 3: **NEW** Insights Table
- Row 4: KPI cards (Total Hours, Total Revenue, Projects, Resources, Resources Under Target)

---

## 2. Questions / Objectives

### 2.1 User Experience
- Add an **Insights** section with:
  - “Generate insights” button (on-demand)
  - Optional “Refresh” and “Compare to previous period” controls
  - Table output with consistent columns and stable ordering
  - Loading + empty + error states

### 2.2 Insight Quality
- Insights must be **grounded** in DB-derived evidence (counts, sums, deltas).
- Output must be **structured** (JSON schema) so the UI can render reliably.
- “Novel” means: anomalies, trends, ratios, concentration, under-utilization, rate mix changes, outliers, and period-over-period deltas.

### 2.3 Guardrails
- Model must not query arbitrary tables.
- All data access must occur via **server-side tools** (read-only) with tenant/date scoping.
- Insights must avoid PII (names/emails) unless the user role explicitly allows it.
- Apply tool-call limits and timeouts to prevent runaway costs.

---

## 3. Confirm Modifications With Me

Before implementing, produce a short plan that answers:
- Which backend runtime is used (Next.js route handler, Express, etc.)
- Which DB access pattern is used (Supabase client with RLS vs service-role with strict tenant filters)
- Which data “tool” endpoints will exist (aggregated queries only)

Proceed after plan is aligned.

---

## 4. Develop a Plan If The Changes Are Okay

### Phase A — Data Contract + Tools (Server)
1) Create a small set of **read-only, aggregated** tool functions, e.g.:
   - `get_kpis(dateStart, dateEnd)`
   - `get_hours_by_resource(dateStart, dateEnd, topN)`
   - `get_hours_by_project(dateStart, dateEnd, topN)`
   - `get_monthly_revenue_series(endMonth, months=12)`
   - `get_under_target_resources(dateStart, dateEnd, targetHours)`
   - `get_outliers(dateStart, dateEnd, thresholdConfig)`

2) Each tool must:
   - Enforce tenant/company scope
   - Enforce date range scope
   - Return aggregated results only (avoid row-level leakage by default)
   - Enforce max rows (topN) and hard ceilings

### Phase B — Insight Generation Endpoint (Server)
- Add a server endpoint: `POST /api/insights`
  - Input: `{ dateStart, dateEnd, compare?: boolean }`
  - Output: JSON schema `Insight[]` (see below)
- Endpoint calls OpenAI using **tool calling** and **structured outputs** so responses are machine-safe and predictable. citeturn0search0turn0search2turn0search3
- Keep OpenAI API key server-side only (never expose to browser).

### Phase C — Dashboard UI Integration (Client)
- Add `<InsightsTable />` component using design-system `<Card>` and table primitives.
- Insert into dashboard between date selector/charts row and KPI cards.
- Provide “Generate” button that calls `/api/insights`.
- Render results with stable sorting (e.g., severity desc, confidence desc, most recent).

### Phase D — Guardrails & Documentation
- Add `/docs/INSIGHTS_GUARDRAILS.md`:
  - Allowed tool set and what each returns
  - PII rules and role-based constraints
  - Max tool calls, timeouts, rate limits
  - Exceptions policy
- Update `STYLEGUIDE.md`:
  - Insights UI pattern (table + badges + confidence)
- Update `CLAUDE.md`:
  - “All insights must be tool-grounded; never hallucinate DB facts.”

---

## 5. Safety & Quality

### Data Safety
- API data sent to OpenAI is not used for training by default unless you opt in. citeturn0search1turn0search10
- Use read-only tools + tenant scoping; do not allow arbitrary SQL from the model.

### Operational Safety
- Rate limit `/api/insights` by user/session.
- Cache results for a short TTL (e.g., 60–180 seconds) per `(tenant, dateStart, dateEnd, compare)` to reduce cost.
- Log:
  - tool calls executed
  - row counts returned
  - insight IDs and confidence
  - errors/timeouts

### UI Safety
- Insights section must not break layout; enforce max height with scroll for table.
- No inline styles; use tokens/components only.

---

## 6. Execute

### 6.1 Agent Assignments (must use my agents)

Use **elite-code-architect** to:
- Define the data contract and tool list
- Design the JSON schema for `Insight[]`
- Define guardrails, limits, caching strategy
- Draft `/docs/INSIGHTS_GUARDRAILS.md`

Use **react-nextjs-reviewer** to:
- Implement the dashboard UI components (Insights section + table)
- Ensure token-consistent styling and atomic consistency
- Add loading/empty/error states and verify layout spacing
- Confirm no hex codes or arbitrary Tailwind values are introduced

(Optional) Use **database-architect** to:
- Create DB views (or RPCs) that return aggregated results efficiently
- Validate RLS implications and tenant scoping
- Recommend indexes for the aggregation queries

If any agent cannot be used in this environment, proceed without it and explicitly document what changed.

---

## 7. Implementation Details

### 7.1 Insight Output Schema (Structured Outputs)

Use structured outputs so the model must return a valid schema. citeturn0search2turn0search8

**Insight (example fields):**
- `id` (string, stable slug)
- `severity` ("high" | "medium" | "low")
- `title` (string)
- `observation` (string)
- `evidence` (array of `{ label, value, period? }`)
- `recommendation` (string)
- `confidence` (0–1)
- `tags` (string[])
- `time_window` (`{ start, end }`)

### 7.2 Guardrail Rules the Model Must Follow
- Only call the provided tools; never assume DB values.
- If evidence is insufficient, return an insight with `confidence <= 0.5` and state what is missing.
- Never include personal identifiers (emails, phone numbers). Resource names only if the authenticated role allows it.

### 7.3 UI Table Columns (default)
- Severity (badge)
- Title
- Evidence (compact)
- Recommendation
- Confidence (%)
- Tags

### 7.4 “Real-time” Definition
“Real-time” here means: results are computed from the **current DB state** when the user clicks **Generate** (not continuously streaming).

---

## 8. Recommended Prompt for Claude Code (copy/paste)

"Enter Plan Mode. Use my agents: elite-code-architect and react-nextjs-reviewer (and database-architect if needed).

Goal: Add an on-demand Insights section to the dashboard that generates novel, evidence-based observations from the current database state within the selected date range.

Backend:
- Implement POST /api/insights (server-side). The server calls OpenAI using tool calling + structured outputs, and the model can only access data through read-only tools we define.
- Create a small set of read-only aggregated tools (kpis, hours by resource/project, monthly revenue series, under-target resources, outliers). Enforce tenant and date scoping in every tool.
- Add rate limiting and short TTL caching (60–180s) per (tenant, dateStart, dateEnd, compare).

Output:
- The endpoint must return a structured Insight[] JSON schema (severity, title, observation, evidence, recommendation, confidence, tags, time_window). The UI must render from this schema.

Frontend:
- Add an Insights Table between the date selector/charts row and KPI cards. Use design-system Card/table components and tokens only (no hex, no arbitrary Tailwind values, no inline styles).
- Add Generate/Refresh button, and loading/empty/error states. Keep layout stable with max height + scroll.

Guardrails:
- Create /docs/INSIGHTS_GUARDRAILS.md and update STYLEGUIDE.md and CLAUDE.md so future work follows the same rules: tool-grounded insights only, no PII, scoped queries only."

---
