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
  created_at: string;
  updated_at: string;
}

export interface ResourceFormData {
  first_name: string;
  last_name: string;
  email: string;
  teams_account: string;
  employment_type_id: string;
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
