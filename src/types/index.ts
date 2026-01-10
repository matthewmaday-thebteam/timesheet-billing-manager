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
export type EmploymentType = 'full-time' | 'part-time';

export interface Resource {
  id: string;
  external_label: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  teams_account: string | null;
  employment_type: EmploymentType;
  created_at: string;
  updated_at: string;
}

export interface ResourceFormData {
  first_name: string;
  last_name: string;
  email: string;
  teams_account: string;
  employment_type: EmploymentType;
}
