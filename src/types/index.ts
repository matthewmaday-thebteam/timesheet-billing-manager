export interface TimesheetEntry {
  id: string;
  clockify_workspace_id: string;
  work_date: string;
  project_id: string | null;
  project_name: string;
  user_id: string | null;
  user_name: string;
  task_id: string | null;
  task_name: string;
  total_minutes: number;
  synced_at: string;
  project_key: string;
  user_key: string;
  task_key: string;
  // Client/Company fields (for Company => Project grouping)
  client_id: string;
  client_name: string;
}

export interface TaskSummary {
  taskName: string;
  totalMinutes: number;
  entries: { date: string; minutes: number }[];
}

export interface ResourceSummary {
  userName: string;
  displayName: string;
  totalMinutes: number;
  weeklyMinutes: Map<string, number>; // week start date -> minutes
  tasks: TaskSummary[];
}

export interface ProjectSummary {
  projectName: string;
  totalMinutes: number;
  resources: ResourceSummary[];
  // Client/Company info (for grouping)
  clientId: string;
  clientName: string;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export type DateFilterMode = 'current' | 'month';

// Employee/Resource Management Types
export interface EmploymentType {
  id: string;
  name: string;
  created_at: string;
}

export type BillingMode = 'monthly' | 'hourly';

// User Association Types (for multi-system time tracking)
export type AssociationSource = 'clockify' | 'clickup';

export interface ResourceUserAssociation {
  id: string;
  resource_id: string;
  user_id: string;
  source: AssociationSource;
  user_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Resource {
  id: string;
  user_id: string | null;
  external_label: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  teams_account: string | null;
  employment_type_id: string;
  employment_type?: EmploymentType;
  billing_mode: BillingMode;
  expected_hours: number | null;
  hourly_rate: number | null;
  monthly_cost: number | null;
  bamboo_employee_id: string | null;
  created_at: string;
  updated_at: string;
  // Multi-system user associations (Clockify, ClickUp, etc.)
  associations?: ResourceUserAssociation[];
}

export interface ResourceFormData {
  first_name: string;
  last_name: string;
  email: string;
  teams_account: string;
  employment_type_id: string;
  billing_mode: BillingMode;
  expected_hours: number | null;
  hourly_rate: number | null;
  monthly_cost: number | null;
  bamboo_employee_id: string | null;
}

// Bulgarian Holidays Types
export interface BulgarianHoliday {
  id: string;
  holiday_name: string;
  holiday_date: string;
  is_system_generated: boolean;
  year: number;
  created_at: string;
  updated_at: string;
}

export interface HolidayFormData {
  holiday_name: string;
  holiday_date: string;
}

// Project Rate Management Types
export interface Project {
  id: string;
  project_id: string;
  project_name: string;
  rate: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectFormData {
  rate: number | null;
}

// ============================================================================
// Monthly Project Rates Types (Task 027)
// ============================================================================

/**
 * A monthly rate record from the project_monthly_rates table.
 */
export interface ProjectMonthlyRate {
  id: string;
  project_id: string;
  rate_month: string;  // ISO date string, always 1st of month (YYYY-MM-DD)
  rate: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Monthly Project Rounding Types
// ============================================================================

/**
 * Valid rounding increment values (in minutes):
 * - 0: Actual (no rounding, use exact minutes)
 * - 5: Round up to nearest 5 minutes
 * - 15: Round up to nearest 15 minutes (default)
 * - 30: Round up to nearest 30 minutes
 */
export type RoundingIncrement = 0 | 5 | 15 | 30;

/**
 * A monthly rounding record from the project_monthly_rounding table.
 */
export interface ProjectMonthlyRounding {
  id: string;
  project_id: string;
  rounding_month: string;  // ISO date string, always 1st of month (YYYY-MM-DD)
  rounding_increment: RoundingIncrement;
  created_at: string;
  updated_at: string;
}

/**
 * Rounding history entry for a project (for RateEditModal).
 */
export interface RoundingHistoryEntry {
  roundingMonth: string;
  roundingIncrement: RoundingIncrement;
  createdAt: string;
  updatedAt: string;
}

/**
 * Month selection for the Rates page.
 */
export interface MonthSelection {
  year: number;
  month: number; // 1-12
}

/**
 * Source of an effective rate:
 * - 'explicit': Rate set explicitly for this month
 * - 'inherited': Rate inherited from a previous month
 * - 'backfill': Viewing month before project existed, using first_seen_month rate
 * - 'default': Fallback when no rate exists (data integrity issue)
 */
export type RateSource = 'explicit' | 'inherited' | 'backfill' | 'default';

/**
 * Project rate display data for the Rates page.
 * Includes "what" (rate/rounding), "why" (source), and context (existence).
 */
export interface ProjectRateDisplay {
  projectId: string;
  externalProjectId: string;
  projectName: string;
  clientId: string | null;
  clientName: string | null;
  firstSeenMonth: string | null;

  // What: the effective rate for the selected month
  effectiveRate: number;

  // Why: where the rate came from
  source: RateSource;
  sourceMonth: string | null;  // The month the rate was set (null for 'default')

  // Context
  existedInSelectedMonth: boolean;  // true if project existed in the selected month

  // Edit info
  hasExplicitRateThisMonth: boolean;  // source === 'explicit'

  // Rounding fields
  effectiveRounding: RoundingIncrement;
  roundingSource: RateSource;
  roundingSourceMonth: string | null;
  hasExplicitRoundingThisMonth: boolean;
}

/**
 * Rate history entry for a project (for RateEditModal).
 */
export interface RateHistoryEntry {
  rateMonth: string;
  rate: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Result from get_all_project_rates_for_month RPC.
 */
export interface ProjectRatesForMonthResult {
  project_id: string;
  external_project_id: string;
  project_name: string;
  client_id: string | null;
  client_name: string | null;
  first_seen_month: string | null;
  effective_rate: number;
  source: RateSource;
  source_month: string | null;
  existed_in_month: boolean;
  // Rounding fields
  effective_rounding: RoundingIncrement;
  rounding_source: RateSource;
  rounding_source_month: string | null;
}

/**
 * Result from get_effective_rates_for_range RPC.
 */
export interface EffectiveRatesForRangeResult {
  project_id: string;
  rate_month: string;
  effective_rate: number;
  source: RateSource;
  source_month: string | null;
}

// User Management Types
export type UserRole = 'admin' | 'user';

export interface AppUser {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  is_verified: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

export interface CreateUserParams {
  email: string;
  password?: string | null;
  display_name?: string | null;
  role?: UserRole;
  send_invite?: boolean;
}

export interface CreateUserResult {
  success: boolean;
  user_id: string;
  email: string;
  role: UserRole;
  is_verified: boolean;
  requires_invite: boolean;
}

export interface UpdateRoleResult {
  success: boolean;
  user_id: string;
  previous_role: UserRole;
  new_role: UserRole;
}

export interface DeleteUserResult {
  success: boolean;
  deleted_user_id: string;
  deleted_email: string;
}

// ============================================================================
// Physical Person Grouping Types
// ============================================================================
// These types support grouping multiple employee entities (from different
// time tracking systems) that represent the same physical person.

/**
 * Role of an entity within the Physical Person grouping system.
 * - 'primary': The anchor entity for a group (shown in Employee table)
 * - 'member': An entity associated to a group (hidden from Employee table)
 * - 'unassociated': An entity not in any group (shown in Employee table)
 */
export type EntityGroupRole = 'primary' | 'member' | 'unassociated';

/**
 * Canonical entity mapping from v_entity_canonical view.
 * Maps any entity_id to its canonical (primary) entity_id.
 */
export interface EntityCanonicalMapping {
  entity_id: string;
  canonical_entity_id: string;
  group_id: string | null;
  role: EntityGroupRole;
}

/**
 * Physical person group record from physical_person_groups table.
 */
export interface PhysicalPersonGroup {
  id: string;
  primary_resource_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

/**
 * Group member record from physical_person_group_members table.
 */
export interface PhysicalPersonGroupMember {
  id: string;
  group_id: string;
  member_resource_id: string;
  created_at: string;
}

/**
 * Member entity display data (for the associations list in modal).
 */
export interface GroupMemberDisplay {
  member_resource_id: string;
  external_label: string;
  first_name: string | null;
  last_name: string | null;
  user_id: string | null;
  added_at: string;
  display_name: string;
}

/**
 * Unassociated entity available for adding to a group (for dropdown).
 */
export interface UnassociatedEntity {
  resource_id: string;
  external_label: string;
  first_name: string | null;
  last_name: string | null;
  user_id: string | null;
  display_name: string;
}

/**
 * Result from rpc_group_get RPC.
 */
export interface GroupGetResult {
  success: boolean;
  entity_id: string;
  role: EntityGroupRole;
  group_id: string | null;
  primary_resource_id: string | null;
  members: GroupMemberDisplay[];
  message?: string;
}

/**
 * Result from group mutation RPCs (create, add, remove).
 */
export interface GroupMutationResult {
  success: boolean;
  group_id: string | null;
  primary_resource_id: string;
  member_resource_ids: string[];
  group_dissolved?: boolean;
  removed_member_resource_id?: string;
}

/**
 * Staged addition of a member entity (local state before save).
 */
export interface StagedMemberAdd {
  resource_id: string;
  display_name: string;
  external_label: string;
  user_id: string | null;
}

/**
 * Complete staged changes state for the Edit Employee modal.
 * Separates persisted state from pending UI changes.
 */
export interface StagedGroupChanges {
  /** Entities staged to be added on Save */
  additions: StagedMemberAdd[];
  /** Entity IDs staged to be removed on Save */
  removals: Set<string>;
}

/**
 * Extended Resource type with grouping information.
 * Used for Employee table display.
 */
export interface ResourceWithGrouping extends Resource {
  /** Entity's role in the grouping system */
  grouping_role: EntityGroupRole;
  /** Group ID if this entity is a primary or member */
  group_id: string | null;
  /** Count of members if this is a primary entity */
  member_count: number;
  /** All system IDs (primary + members) for display */
  all_system_ids: string[];
}

// ============================================================================
// Company Types
// ============================================================================

/**
 * Company record from the companies table.
 */
export interface Company {
  id: string;
  client_id: string;
  client_name: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Company form data for editing.
 */
export interface CompanyFormData {
  display_name: string;
}

/**
 * Role of a company within the Company grouping system.
 */
export type CompanyGroupRole = 'primary' | 'member' | 'unassociated';

/**
 * Company with grouping information for table display.
 */
export interface CompanyWithGrouping extends Company {
  grouping_role: CompanyGroupRole;
  group_id: string | null;
  member_count: number;
  project_count: number;
}

/**
 * Member company display data for modal.
 */
export interface CompanyGroupMemberDisplay {
  member_company_id: string;
  client_id: string;
  client_name: string;
  display_name: string | null;
  added_at: string;
}

/**
 * Unassociated company available for grouping.
 */
export interface UnassociatedCompany {
  company_id: string;
  client_id: string;
  client_name: string;
  display_name: string;
}

/**
 * Result from rpc_company_group_get RPC.
 */
export interface CompanyGroupGetResult {
  success: boolean;
  company_id: string;
  role: CompanyGroupRole;
  group_id: string | null;
  primary_company_id: string | null;
  members: CompanyGroupMemberDisplay[];
  message?: string;
}

/**
 * Result from company group mutation RPCs.
 */
export interface CompanyGroupMutationResult {
  success: boolean;
  group_id: string | null;
  primary_company_id: string;
  member_company_ids: string[];
  group_dissolved?: boolean;
  removed_member_company_id?: string;
}

/**
 * Staged addition of a member company.
 */
export interface StagedCompanyMemberAdd {
  company_id: string;
  display_name: string;
  client_id: string;
  client_name: string;
}

/**
 * Staged changes for company grouping.
 */
export interface StagedCompanyGroupChanges {
  additions: StagedCompanyMemberAdd[];
  removals: Set<string>;
}

// ============================================================================
// Project Grouping Types
// ============================================================================

/**
 * Role of a project within the Project grouping system.
 */
export type ProjectGroupRole = 'primary' | 'member' | 'unassociated';

/**
 * Project with grouping information for table display.
 */
export interface ProjectWithGrouping extends Project {
  grouping_role: ProjectGroupRole;
  group_id: string | null;
  member_count: number;
  company_uuid: string | null;
  company_display_name: string | null;
}

/**
 * Member project display data for modal.
 */
export interface ProjectGroupMemberDisplay {
  member_project_id: string;
  project_id: string;
  project_name: string;
  added_at: string;
}

/**
 * Unassociated project available for grouping.
 */
export interface UnassociatedProject {
  id: string;
  project_id: string;
  project_name: string;
}

/**
 * Result from rpc_project_group_get RPC.
 */
export interface ProjectGroupGetResult {
  success: boolean;
  project_id: string;
  role: ProjectGroupRole;
  group_id: string | null;
  primary_project_id: string | null;
  members: ProjectGroupMemberDisplay[];
  message?: string;
}

/**
 * Result from project group mutation RPCs.
 */
export interface ProjectGroupMutationResult {
  success: boolean;
  group_id: string | null;
  primary_project_id: string;
  member_project_ids: string[];
  group_dissolved?: boolean;
  removed_member_project_id?: string;
}

/**
 * Staged addition of a member project.
 */
export interface StagedProjectMemberAdd {
  id: string;
  project_id: string;
  project_name: string;
}

/**
 * Staged changes for project grouping.
 */
export interface StagedProjectGroupChanges {
  additions: StagedProjectMemberAdd[];
  removals: Set<string>;
}

// ============================================================================
// Monthly Billing Rules Types (Task 028)
// ============================================================================

/**
 * Billing limits configuration for a project.
 */
export interface ProjectBillingLimits {
  minimumHours: number | null;      // NULL = no minimum (retainer hours)
  maximumHours: number | null;      // NULL = unlimited (cap on billable hours)
  carryoverEnabled: boolean;        // When true, excess hours carry to next month
  carryoverMaxHours: number | null; // Maximum carryover accumulation (prevents unbounded liability)
  carryoverExpiryMonths: number | null; // Months until carryover expires (FIFO)
}

/**
 * Billing month lifecycle status.
 */
export type BillingMonthStatusType = 'open' | 'calculating' | 'closed' | 'reopened';

/**
 * Billing month status record.
 */
export interface BillingMonthStatus {
  projectId: string;
  billingMonth: string;
  status: BillingMonthStatusType;
  totalHoursWorked: number | null;
  totalBilledHours: number | null;
  carryoverGenerated: number | null;
  closedAt: string | null;
  closedBy: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  reopenReason: string | null;
}

/**
 * Source of carryover hours (for audit trail).
 */
export interface CarryoverSource {
  sourceMonth: string;
  hours: number;
  calculatedAt: string;
}

/**
 * Discriminated union for billing adjustment types.
 * Ensures type safety by preventing invalid states.
 */
export type BillingAdjustment =
  | { type: 'none' }
  | { type: 'minimum_applied'; minimumHours: number; paddingHours: number }
  | { type: 'maximum_applied'; maximumHours: number; carryoverOut: number }
  | { type: 'maximum_applied_unbillable'; maximumHours: number; unbillableHours: number };

/**
 * Complete result from billing hours calculation.
 * Includes all stages of the calculation for audit/display.
 */
export interface BilledHoursResult {
  // Input values
  actualHours: number;          // Raw hours worked (before rounding)
  roundedHours: number;         // After per-task rounding
  carryoverIn: number;          // Carryover hours from previous months

  // Calculated values
  adjustedHours: number;        // roundedHours + carryoverIn
  billedHours: number;          // After min/max applied (final billable)

  // Output values
  carryoverOut: number;         // Hours to carry to next month (when max exceeded with carryover enabled)
  unbillableHours: number;      // Hours that won't be billed (when max exceeded without carryover)
  carryoverConsumed: number;    // How much of carryoverIn was used (FIFO consumption)
  minimumPadding: number;       // Hours added due to minimum (billedHours - adjustedHours when min applied)

  // Flags for display indicators
  minimumApplied: boolean;
  maximumApplied: boolean;

  // Discriminated union for type-safe adjustment handling
  adjustment: BillingAdjustment;

  // Revenue (calculated from billedHours * rate)
  revenue: number;
}

/**
 * Billing limits history entry for a project (for RateEditModal).
 */
export interface BillingLimitsHistoryEntry {
  limitsMonth: string;
  minimumHours: number | null;
  maximumHours: number | null;
  carryoverEnabled: boolean;
  carryoverMaxHours: number | null;
  carryoverExpiryMonths: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Active status history entry for a project (for RateEditModal).
 */
export interface ActiveStatusHistoryEntry {
  statusMonth: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Extended ProjectRateDisplay with billing limits and active status.
 * Used for the Rates page display with all project configuration.
 */
export interface ProjectRateDisplayWithBilling extends ProjectRateDisplay {
  // Billing limits
  minimumHours: number | null;
  maximumHours: number | null;
  carryoverEnabled: boolean;
  carryoverMaxHours: number | null;
  carryoverExpiryMonths: number | null;
  limitsSource: RateSource;
  limitsSourceMonth: string | null;
  hasExplicitLimitsThisMonth: boolean;

  // Active status (controls whether minimum applies)
  isActive: boolean;
  activeSource: RateSource;
  activeSourceMonth: string | null;
  hasExplicitActiveThisMonth: boolean;

  // Carryover available for this month
  carryoverHoursIn: number;
  carryoverSources: CarryoverSource[];
}

/**
 * Extended result from get_all_project_rates_for_month RPC (includes billing fields).
 */
export interface ProjectRatesForMonthResultWithBilling extends ProjectRatesForMonthResult {
  // Billing limits fields
  minimum_hours: number | null;
  maximum_hours: number | null;
  carryover_enabled: boolean;
  carryover_max_hours: number | null;
  carryover_expiry_months: number | null;
  limits_source: RateSource;
  limits_source_month: string | null;

  // Active status fields
  is_active: boolean;
  active_source: RateSource;
  active_source_month: string | null;

  // Carryover available
  carryover_hours_in: number;
}

// ============================================================================
// Employee Time-Off Types (BambooHR Integration)
// ============================================================================

/**
 * BambooHR employee record from bamboo_employees table.
 */
export interface BambooEmployee {
  id: string;
  bamboo_id: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string;
}

/**
 * Employee time-off record from employee_time_off table.
 */
export interface EmployeeTimeOff {
  id: string;
  bamboo_request_id: string;
  bamboo_employee_id: string;
  resource_id: string | null;
  employee_name: string;
  employee_email: string | null;
  time_off_type: string;
  status: string;
  start_date: string;
  end_date: string;
  total_days: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string;
}
