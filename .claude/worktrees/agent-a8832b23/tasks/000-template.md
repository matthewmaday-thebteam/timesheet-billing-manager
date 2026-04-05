# Task 011: Aircraft Table Schema Cleanup - part 3

**Status:** COMPLETE

## 1. Problem Statement

I need to ask a few questions about the database so that we can complete the rearcitecture of the
  listings tables. The goal for today is to finish the listings tables so we can begin to add features
  again without confusion.

  ## 1. QUESTIONS

  is listing_authorities being used? It seems like this table should be used and contain the data in
  aircraft_authority. The authority would belong to an actual aircraft for sale, not to a model

  do we still need aircraft_backup? this seems like tech debt and all backups should not exists as a table
  in the database but as a file locally

  What is aircraft_attributes used for?

  aircraft_defaults seems outdated. Is it possible to remove this?

  aircraft_flight rules seems like it is supposed to be listing_flight_rules. Flight rules belong to a
  listing as each aircraft will be different depending on the specific configuration that is listed. It
  does npt belong to an aircraft.

  aircraft_photos seems deprecated. These media belong to a listing and should be managed via the
  listing_media table

  is registration_prefixes table being used? How does it differ from aircraft_registration?

  aircraft_registration should be a listing value - thus starting with listing_registration

  Can we consoledate seller_id and user_id in aircraft table?

  Can we rename aircraft table to listings?


## 2. confirm modificatins with me

spawn a elite-code-architect and database-architect to review the findings first. 
If the finding seem incomplete, return to "## 1. QUESTIONS"

oraginze the findings for me to review

## 4. develop a plan if the changes are okay

- have  elite-code-architect identify the impact to the front end and to determine how to not break the react 
- have  elite-code-architect identify necessary changes to the API
- have database-architect identify necesary changes to the database
- have database-architect figure and document how database-architect can access subabase without failing every other time
- have elite-code-architect review the plan and then present it to me

## 5. Saftey

- have  database-architect generate a backup and database revert migration file for all changes
- have elite-code-architect commit and push changes
- have elite-code-architect update the task

## 6. execute

- have database-architect make the required changes to the database
- have elite-code-architect review before continuing
- have elite-code-architect make changes to the api
- have elite-code-architect review before continuing
- have  react-nextjs-reviewer make the necessary changes to the app
- have elite-code-architect review before continuing
- test the typescript



## 7. Implementation Notes

**Investigation Date:** 2026-01-06

---

## INVESTIGATION FINDINGS

### Question 1: listing_authorities vs aircraft_authority

| Table | Purpose | Status | Data |
|-------|---------|--------|------|
| `aircraft_authority` | Lookup table (FAA, EASA, TCCA, etc.) | **ACTIVE** | Reference data |
| `listing_authorities` | Junction table (listing ↔ authority) | **ACTIVE** | Many-to-many links |

**Answer:** Both are needed and correctly designed. `aircraft_authority` holds the master list of authorities. `listing_authorities` links specific listings to their applicable authorities (many-to-many). This is proper normalization.

**Recommendation:** ✅ **KEEP BOTH** - Correct architecture

---

### Question 2: aircraft_backup / aircraft_backup_20260105

| Table | Purpose | Status |
|-------|---------|--------|
| `aircraft_backup_20260105` | Pre-migration 130 backup | **TECH DEBT** |

**Answer:** These are backup tables created during migrations. The comment in migration 130 says: *"Backup before migration 130 cleanup - can be dropped after verification"*

**Recommendation:** 🗑️ **REMOVE** - Drop backup tables. Use file-based backups in `supabase/backups/` instead.

---

### Question 3: aircraft_attributes

| Table | Purpose | Status | Usage |
|-------|---------|--------|-------|
| `aircraft_attributes` | Junction: aircraft ↔ attribute_options | **ACTIVE** | 6+ methods in supabase-provider |

**Answer:** This is the junction table for flexible attribute assignment. It links aircraft/listings to options from `attribute_options`. Used by `setAircraftAttributes()`, `addAircraftAttribute()`, `removeAircraftAttribute()`.

**Recommendation:** ✅ **KEEP** - Active junction table for dynamic categorization

---

### Question 4: aircraft_defaults

| Table | Purpose | Status | Data |
|-------|---------|--------|------|
| `aircraft_defaults` | FAA reference data for auto-fill | **ACTIVE** | ~1000 rows |

**Answer:** Contains FAA reference data for aircraft specifications. Used to auto-populate form fields (cruise speed, range, fuel capacity, etc.) when a user selects a make/model. The `useAircraftDefaults` hook provides debounced lookup.

**Recommendation:** ✅ **KEEP** - Valuable UX feature for form auto-fill

---

### Question 5: aircraft_flightrules vs listing_flight_rules

| Table | Purpose | Status |
|-------|---------|--------|
| `aircraft_flightrules` | **Lookup table** (VFR, IFR, VFR/IFR) | **ACTIVE** |
| `listing_flight_rules` | **Junction table** (listing ↔ flight rule) | **ACTIVE** |

**Answer:** Both serve different purposes:
- `aircraft_flightrules` = "What flight rules exist" (reference data)
- `listing_flight_rules` = "What flight rules apply to THIS listing" (junction)

**Recommendation:** ✅ **KEEP BOTH** - Correct lookup + junction pattern

---

### Question 6: aircraft_photos

| Table | Purpose | Status | Usage |
|-------|---------|--------|-------|
| `aircraft_photos` | Legacy photo storage | **DEPRECATED** | 0 references in code |
| `listing_media` | Current media system | **ACTIVE** | Full CRUD |

**Answer:** `aircraft_photos` is NOT referenced anywhere in the frontend code. The application uses `listing_media` for all media management.

**Recommendation:** 🗑️ **REMOVE** - Drop `aircraft_photos` table if it exists

---

### Question 7: registration_prefixes vs aircraft_registration

| Table | Purpose | Examples |
|-------|---------|----------|
| `registration_prefixes` | Country-based prefixes | N (USA), G (UK), VH (Australia) |
| `aircraft_registration` | Registration types | Standard, Experimental, Light Sport |

**Answer:** These serve **different purposes**:
- `registration_prefixes` (48 rows): Validates registration format by country
- `aircraft_registration`: Categorizes registration type

**Note:** Migration 104 may have caused confusion by populating aircraft_registration from registration_prefixes.

**Recommendation:** ✅ **KEEP BOTH** - Clarify naming. Consider renaming `aircraft_registration` to `registration_types` for clarity.

---

### Question 8: aircraft_registration → listing_registration?

**Answer:** The current FK is `aircraft.registration_type_id → aircraft_registration(id)`. This is correct - the registration TYPE is listing-specific (seller specifies their aircraft's registration type), but the lookup table name should stay as-is since it contains aircraft-related reference data.

**Recommendation:** ✅ **KEEP AS-IS** - No rename needed

---

### Question 9: seller_id vs user_id

| Column | Status | Usage |
|--------|--------|-------|
| `user_id` | **ACTIVE** | FK to auth.users - the seller |
| `seller_id` | **LEGACY** | 8 RLS policies reference it |

**Answer:** The codebase uses `user_id` consistently. The TypeScript types use `user_id`. `seller_id` is legacy but retained because 8 RLS policies depend on it.

**Recommendation:** 🔄 **CONSOLIDATE** - Migrate RLS policies to use `user_id`, then drop `seller_id`

---

### Question 10: Rename aircraft table to listings?

| Aspect | Impact |
|--------|--------|
| **Database** | Rename table, update FK constraints |
| **API Routes** | 23 files in `/api/aircraft/` |
| **Hooks** | 4+ files (useAircraft, useAircraftDefaults, etc.) |
| **Types** | 75+ references to Aircraft type |
| **Components** | 10+ files reference Aircraft |
| **URLs** | Breaking change: `/aircraft/` → `/listings/` |

**Answer:** This would impact ~50+ files with ~200+ type references. The junction tables already use "listing" naming (`listing_engines`, `listing_authorities`, etc.).

**Recommendation:** ⏸️ **DEFER** - High-impact change. Do as a separate dedicated task if needed.

---

## SUMMARY: Recommended Actions

### 🗑️ REMOVE (Low Risk)
| Action | Impact |
|--------|--------|
| Drop `aircraft_backup_20260105` | Tech debt cleanup |
| Drop `aircraft_photos` | Unused legacy table |

### 🔄 MODIFY (Medium Risk)
| Action | Impact |
|--------|--------|
| Consolidate `seller_id` → `user_id` | Update 8 RLS policies |

### ⏸️ DEFER (High Risk)
| Action | Reason |
|--------|--------|
| Rename `aircraft` → `listings` | 50+ files, major refactor |

### ✅ NO CHANGE NEEDED
- `listing_authorities` / `aircraft_authority` - Correct
- `aircraft_attributes` - Active and needed
- `aircraft_defaults` - Valuable FAA data
- `aircraft_flightrules` / `listing_flight_rules` - Correct pattern
- `registration_prefixes` / `aircraft_registration` - Different purposes

---

## AWAITING APPROVAL

Please review the findings above and confirm:
1. ✅ Proceed with REMOVE actions (backup tables, aircraft_photos)?
2. ✅ Proceed with seller_id → user_id consolidation?
3. ❌ Skip renaming aircraft table for now?

---

### Files Created:
- `supabase/migrations/134_rename_tables_naming_convention.sql` - Renames 24 tables
- `supabase/migrations/135_fix_registration_data.sql` - Restores correct registration categories
- `supabase/migrations/136_cleanup_legacy_tables.sql` - Drops backup tables, seller_id
- `supabase/rollbacks/134_rollback_rename_tables.sql` - Rollback for migration 134

### Files Modified:
- `src/lib/db/types.ts` - New type names + backward compatibility aliases
- `src/lib/db/supabase-provider.ts` - Updated all table references
- `src/lib/api.ts` - Updated type exports
- `src/hooks/useConfigurationData.ts` - Updated type imports
- `src/hooks/useListingJunctions.ts` - Updated junction types
- `src/hooks/useAvionics.ts` - Updated avionics types
- `src/hooks/useCondition.ts` - Updated condition types
- `src/app/admin/aircraft/page.tsx` - Updated type imports
- `src/app/admin/avionics/page.tsx` - Updated type imports
- `src/app/admin/maintenance/page.tsx` - Updated type imports
- `src/components/windows/ConfigurationWindow.tsx` - Updated comments
- `src/components/windows/InventoryWindow.tsx` - Updated comments

### Migration 134 Actions (Table Renames):

**Lookup Tables (13):**
| Old Name | New Name |
|----------|----------|
| aircraft_authority | listing_authority |
| aircraft_flightrules | listing_flightrule |
| avionics_capabilities | listing_capability |
| avionics_certifications | listing_certification |
| condition_airworthiness | listing_airworthiness |
| condition_damage | listing_damage |
| condition_logbooks | listing_logbook |
| condition_condition | listing_condition |
| condition_storage | listing_storage |
| condition_corrosion | listing_corrosion |
| condition_interior | listing_interior |
| condition_paint | listing_paint |
| condition_maintenance | listing_maintenance |
| registration_prefixes | listing_registration_prefix |
| aircraft_registration | listing_registration_category |

**Junction Tables (9):**
| Old Name | New Name |
|----------|----------|
| listing_authorities | listing_authority_jnct |
| listing_flight_rules | listing_flightrule_jnct |
| listing_badges | listing_badge_jnct |
| listing_flags | listing_flag_jnct |
| listing_capabilities | listing_capability_jnct |
| listing_certifications | listing_certification_jnct |
| listing_engines | listing_engine_jnct |
| listing_propellers | listing_propeller_jnct |
| listing_avionics | listing_avionics_jnct |

### Migration 135 Actions (Fix Registration Data):
- Backed up corrupted registration_category data
- Restored original 7 registration categories:
  - Standard Airworthiness
  - Experimental
  - Limited
  - Restricted
  - Special Airworthiness
  - Provisional
  - Light Sport Aircraft (LSA)
- Set is_priority flags for top 15 countries in registration_prefix

### Migration 136 Actions (Cleanup):
- Dropped `aircraft_backup` table
- Dropped `aircraft_backup_20260105` table
- Dropped `aircraft_photos` table (unused)
- Consolidated `seller_id` to `user_id` and dropped seller_id column

### TypeScript Changes:
- All types renamed with backward compatibility aliases
- New naming convention: `Listing*` for lookup types, `*Jnct` for junction types
- Example: `AircraftAuthority` -> `ListingAuthority` (alias preserved)

### Backup:
- `supabase/backups/2026-01-06T14-56-21-287Z`

### Status: COMPLETE ✓

### Deployment Notes (2026-01-06)

**Migration 134:** Applied successfully
- Renamed 24 tables (13 lookup + 9 junction + 2 registration)
- Updated FK constraints conditionally for existing columns
- Added new RLS policies with new table names
- Added table comments for documentation

**Migration 135:** Applied successfully
- Restored correct registration categories (7 types)
- Set priority flags for top 15 countries

**Migration 136:** Applied successfully
- Dropped backup tables: `aircraft_backup`, `aircraft_backup_20260105`
- Dropped unused table: `aircraft_photos`
- Consolidated `seller_id` to `user_id`
- Dropped 5 RLS policies referencing seller_id
- Recreated policies using user_id
- Aircraft table now has **58 columns** (down from 59)

**Note on MemberType:**
The `MemberType` enum values (e.g., `aircraft_flightrules`, `aircraft_authority`) were NOT changed. These are application-level discriminators stored in `attribute_group_members.member_type`, not database table names. The supabase-provider maps these to the correct new table names.

### Final Results:

| Metric | Before | After |
|--------|--------|-------|
| Tables renamed | 0 | 24 |
| Registration categories | 48 (corrupted) | 7 (correct) |
| Backup tables dropped | 0 | 2 |
| Aircraft columns | 59 | 58 |
| seller_id consolidated | No | Yes (→ user_id) |

**Production URL:** https://airplanemarket-next.vercel.app
**Commit:** `27694a5`
**Completed:** 2026-01-06

---

## Additional Cleanup (2026-01-06)

### Migration 137: Drop Unused Views
- Dropped `v_aircraft_engine_count` (created but never integrated)
- Dropped `v_aircraft_model_info` (created but never integrated)

### Migration 138: Move Aspiration and Fuel Delivery to Right Column
- Updated `engine_aspiration` column_position to 2
- Updated `engine_fuel_delivery` column_position to 2

### Migration 139: Fix Cascading Dropdown Sort Order
Fixed issue where Cylinder Stages appeared between Engine Model and Propeller Manufacturer.

**Problem:** Cascading dropdowns (Engine Manufacturer/Model, Propeller Manufacturer/Model) span both columns but had lower sort_order values than single-column items.

**Solution:** Set cascading dropdowns to high sort_order values:
- engine_manufacturer_model: sort_order 900
- propeller_manufacturer_model: sort_order 910
- Single-column items: sort_order 10-30

**Result:** Cascading dropdowns now render AFTER all single-column components.

**Final Commit:** `8dd270b`
