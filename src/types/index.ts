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
}

export interface DateRange {
  start: Date;
  end: Date;
}

export type DateFilterMode = 'current' | 'month' | 'custom';

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
