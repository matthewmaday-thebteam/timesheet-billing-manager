# Task 023: Physical Person Entity Grouping & Association Logic

Status: PENDING
Depends on: task-022-employee-rate-enhancements.md (style + any shared employee modal patterns)
Owners: Claude Code (multi-agent)
Agents: 2x database-architect, 2x elite-code-architect

## 1. Context & Problem Statement

We ingest "employee/user" entities from multiple timekeeping systems. The same physical person may exist multiple times (one record per system), producing duplicate headcount in the Employee list and double-counting in reports.

A prior implementation mistake created an association table where all users are "represented," implying all users are inherently associated. This is wrong. A `user_id` (or employee entity ID) is a unique entity and should remain unassociated unless an admin explicitly groups it.

We need an explicit grouping model:
- A group is anchored by one Primary entity (the one the admin opened and used to create the first association).
- Other entities may be attached as Members/Associated.
- Members are hidden from the main Employee table.
- Reports aggregate by the Primary entity (primary + all member entities).

## 2. Goals

1. Allow admins to create and manage Physical Person groups:
   - Add an unassociated entity to a Primary entity's group
   - Remove an associated entity from a group
   - Dissolve a group by removing all members (Primary remains; the group row should disappear)
2. Enforce strict invariants:
   - Only unassociated entities can be added to a group
   - An entity can belong to at most one group
   - The Primary entity never appears in the "User Associations" list and cannot be removed from its group
3. Update employee listing + reports:
   - Employee table shows:
     - All unassociated entities
     - All Primary entities
     - Never show Member entities
   - Reporting sums hours/costs by Primary entity (canonical entity)

## 3. Definitions

Entity: a single imported or local employee/user record (unique ID).
Primary entity: the anchor entity for a group.
Member entity: an entity associated to a Primary entity's group.
Unassociated entity: an entity that is not a Primary and not a Member.

Canonical entity ID: the Primary entity ID for grouped entities; otherwise the entity's own ID.

## 4. Business Rules (Non-Negotiable)

BR-1: An entity can belong to 0 or 1 group.
BR-2: A group is created only when an admin adds the first member to an unassociated entity.
BR-3: Only unassociated entities can be added as members.
BR-4: The Primary entity never appears in the modal "User Associations" list.
BR-5: The Primary entity cannot be unassociated/removed.
BR-6: A group is dissolved if it has zero members (i.e., after removing the last member).
BR-7: Member entities are hidden from Employee table and treated as "attached" in reports.
BR-8: Reports aggregate by canonical entity (Primary).

## 5. Deliverables

A) Database
- New schema implementing primary/member grouping
- Constraints to enforce BR-1..BR-6
- Migration plan to remove/ignore the broken prior association approach (no default associations)
- SQL view(s) or RPC(s) that make canonical mapping easy for queries and reporting
- RLS policies compatible with admin-only mutation

B) API / Data access layer (Supabase)
- Atomic RPC functions for:
  - create group + add member
  - add member to existing group
  - remove member (and dissolve group if last)
- Query helpers for:
  - list "unassociated entities" (for dropdown)
  - list group members for a primary (for modal)
  - canonical mapping for reporting and rollups

C) UI
- Employee table filtering to show only Unassociated + Primary
- Edit Employee modal enhancements:
  - Add User Association dropdown (unassociated only)
  - Associated Users list with remove (X)
  - Correct save behavior (staging changes, then persist)
  - Primary is not listed and is not removable
- Detail display shows multiple system IDs when grouped

D) Reporting
- Any rollups / report queries updated to aggregate by canonical (Primary) entity

## 6. Agent Plan

### 6.1 database-architect (x2)
1) Propose schema and constraints (see Section 7 template).
2) Propose view(s) for canonical mapping and employee table filtering.
3) Propose RPC functions for atomic group mutations (create/add/remove/dissolve).
4) Define migration steps from the broken association implementation:
   - Ensure no implicit grouping remains
   - Ensure existing reporting queries don't double-count
5) Define edge cases:
   - What if Primary entity is deleted? (Recommendation: prevent deletion if group exists OR dissolve group first via trigger/RPC)
   - What if a member entity is deleted? (Recommendation: auto-remove member; dissolve if last)
   - Concurrency (two admins editing associations)

### 6.2 elite-code-architect (x2)
1) UI state model for modal: staged adds/removes, persisted on Save.
2) Data fetching plan:
   - load primary entity (or canonical entity)
   - load members
   - load dropdown options (unassociated, excluding primary)
3) Employee table query + UI display logic:
   - hide members
   - show system IDs for primary including members
4) Update reporting query paths / rollup jobs to canonicalize entity IDs.

## 7. Proposed Schema (Implementation Target)

NOTE: Adjust table names to match existing schema conventions (employees/users table naming).

### 7.1 Tables

1) physical_person_groups
- id (uuid pk, default gen_random_uuid())
- primary_entity_id (uuid not null, fk -> employee_entities.id)
- created_at (timestamptz not null default now())
- created_by (uuid null, optional)

Constraints:
- unique(primary_entity_id)
- primary_entity_id must not appear as a member in any group

2) physical_person_group_members
- group_id (uuid not null, fk -> physical_person_groups.id on delete cascade)
- member_entity_id (uuid not null, fk -> employee_entities.id on delete cascade)
- created_at (timestamptz not null default now())

Constraints:
- unique(member_entity_id)  -- enforces "entity belongs to only 1 group"
- unique(group_id, member_entity_id)
- member_entity_id != (select primary_entity_id for group_id)  -- implement via trigger if needed

### 7.2 Canonical Mapping View

Create a view to map any entity_id -> canonical_entity_id:

v_entity_canonical
- entity_id
- canonical_entity_id
- group_id
- role: 'primary' | 'member' | 'unassociated'

Logic:
- If entity_id is a group primary: canonical = entity_id
- Else if entity_id is a group member: canonical = group.primary_entity_id
- Else canonical = entity_id

### 7.3 Employee Table Filter View

v_employee_table_entities
- returns entities that should appear in Employees table:
  - unassociated entities
  - primary entities
- excludes all member entities

Implementation:
- include entity if NOT EXISTS in physical_person_group_members as member_entity_id
  (this naturally includes primaries + unassociated)

## 8. RPC Functions (Atomic Mutations)

Because client-side multi-step inserts/deletes can race, implement as Postgres functions:

1) rpc_group_create_and_add_member(primary_entity_id, member_entity_id)
Rules:
- primary must be unassociated (not a primary already, not a member)
- member must be unassociated
- create group row
- insert member row

2) rpc_group_add_member(primary_entity_id, member_entity_id)
Rules:
- group must exist for primary_entity_id
- member must be unassociated
- insert member row

3) rpc_group_remove_member(primary_entity_id, member_entity_id)
Rules:
- group must exist
- member must be a member of that group
- delete member row
- if member count becomes 0, delete group row (dissolve)

Optional guard RPC:
4) rpc_group_get(primary_entity_id) -> group + members

All RPCs should return a consistent payload the UI can rehydrate from:
- group_id
- primary_entity_id
- member_entity_ids[]
- canonical_entity_id for each impacted entity (if helpful)

RLS:
- Only admin role can call mutation RPCs.
- Read-only views available to authenticated users if needed.

## 9. UI/UX Requirements

### 9.1 Employee Table
- Data source must exclude group members (members never appear as standalone rows)
- For any primary entity:
  - display primary info (name, rate, etc.) as usual
  - display "System IDs" list including:
    - primary system id(s)
    - member system id(s)
- Unassociated entities display normally.

### 9.2 Edit Employee Modal

Opening behavior:
- Modal can open from Employee table rows (these are only Unassociated or Primary).
- If modal is opened by some deep link for a Member entity (edge case), UI should:
  - resolve canonical primary and show primary modal instead, or display a clear "This entity is associated; edit via primary" path.

Sections:
A) Primary entity details (existing fields)
B) System IDs (existing + aggregated)
C) User Associations (new)

Add association flow:
1. Button: "Add User Association"
2. Dropdown shows only Unassociated entities
3. Exclude current entity (primary) from dropdown
4. On Add:
   - If current entity is unassociated: create group + add member
   - If current entity is primary: add member to existing group
5. Save Changes persists staged operations (use RPC).

User Associations list:
- Shows only member entities (not the primary)
- Each row has Remove (X)
- Removing members is staged until Save Changes
- Save Changes calls rpc_group_remove_member for each removed member
- If last member removed, group dissolves automatically (primary becomes unassociated again)

Validation:
- Prevent selecting entities that are not unassociated (should not appear anyway)
- Prevent associating an entity already grouped (server RPC should enforce)

## 10. Reporting / Aggregation Requirements

All reporting that currently groups/sums by entity_id must be updated to group/sum by canonical_entity_id.

Implementation options:
- Join time entries -> v_entity_canonical to compute canonical_entity_id at query time
- Or materialize canonical_entity_id into rollup tables (recommended only if required for performance)

Acceptance:
- When a group exists, primary row shows aggregated totals (primary + members)
- When group is dissolved, totals revert to independent per-entity totals

## 11. Migration Plan (Fix Prior Mistake)

We must remove the incorrect assumption that all users are "represented" in an association table.

Migration steps:
1) Introduce new group tables + views + RPCs (do not backfill associations).
2) Update Employee table query to v_employee_table_entities (or equivalent filter).
3) Update modal to use new group model only.
4) Update reporting queries to canonicalize.
5) Deprecate old association table usage:
   - stop writing to it
   - remove UI references
   - drop table only after confirming no dependencies (or keep but unused if risky).
6) Data cleanup:
   - Ensure there are no accidental member rows created for every user
   - Any existing "bad" associations should be dropped (truncate or targeted delete), then admins can rebuild valid groups manually.

## 12. Acceptance Criteria

AC-1: An admin can group two unassociated entities by editing one and adding the other.
AC-2: After grouping:
- Employee table shows only the primary entity row
- Member entity disappears from Employee table
- Primary shows multiple System IDs (primary + member)
- Reports aggregate totals as one physical person

AC-3: The association dropdown only shows unassociated entities and never includes the primary.
AC-4: The primary never appears in the User Associations list and cannot be removed.
AC-5: An entity cannot be in more than one group (server-enforced).
AC-6: Removing a member and saving:
- Member returns to Employee table
- Aggregated reporting reverts correctly
AC-7: Removing the last member dissolves the group automatically.

## 13. Test Plan

Database tests (SQL):
- Creating group with unassociated primary+member works
- Attempt add member that is already a member fails
- Attempt add member that is a primary fails
- Removing member dissolves group when last member removed
- v_entity_canonical returns correct canonical ids

UI tests:
- Dropdown population correctness
- Employee table hides members
- Modal reflects members correctly after Save
- Reporting screens show correct aggregation before/after group changes

## 14. Out of Scope (Explicit)

- Automatic matching/deduping by name/email (future task)
- Bulk grouping tooling (future task)
- Cross-system identity resolution heuristics (future task)

## 15. Notes / Guidance

- Do not create any association rows by default.
- Associations only exist when explicitly created by an admin action.
- Prefer RPC-based atomic operations to avoid race conditions and partial saves.
