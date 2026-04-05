/**
 * Shared Mock Data for Style Review Previews
 *
 * Provides realistic sample data for component previews that don't
 * connect to the Supabase backend.
 */

import type {
  TimesheetEntry,
  TaskSummary,
  ResourceSummary,
  ProjectSummary,
  Resource,
  BulgarianHoliday,
  AppUser,
  EmployeeTimeOff,
} from '../../types';
import type { BarChartDataPoint } from '../../components/atoms/charts/BarChartAtom';
import type { CAGRProjectionDataPoint } from '../../types/charts';
import type { UnderHoursResource } from '../../utils/calculations';

// ============================================================================
// Chart Data
// ============================================================================

export const mockBarChartData: BarChartDataPoint[] = [
  { month: 'Jan', value: 12.5 },
  { month: 'Feb', value: -3.2 },
  { month: 'Mar', value: 8.1 },
  { month: 'Apr', value: 15.4 },
  { month: 'May', value: -7.8 },
  { month: 'Jun', value: 4.6 },
  { month: 'Jul', value: null },
  { month: 'Aug', value: null },
  { month: 'Sep', value: null },
  { month: 'Oct', value: null },
  { month: 'Nov', value: null },
  { month: 'Dec', value: null },
];

export const mockCAGRData: CAGRProjectionDataPoint[] = [
  { month: '2022', actual: 846852, projected: null },
  { month: '2023', actual: 1187720, projected: null },
  { month: '2024', actual: 1245857, projected: null },
  { month: '2025', actual: 1580000, projected: null },
  { month: '2026', actual: null, projected: 1780000 },
  { month: '2027', actual: null, projected: 2005000 },
];

// ============================================================================
// Timesheet & Resource Data
// ============================================================================

const now = new Date().toISOString();
const currentYear = new Date().getFullYear();

export const mockTimesheetEntries: TimesheetEntry[] = [
  {
    id: 'ts-1', clockify_workspace_id: 'ws-1', work_date: `${currentYear}-02-10`,
    project_id: 'p-1', project_name: 'FoodCycleScience', user_id: 'u-1',
    user_name: 'Kalin Tomanov', task_id: 't-1', task_name: 'Development',
    total_minutes: 510, synced_at: now, project_key: 'p-1', user_key: 'u-1',
    task_key: 't-1', client_id: 'c-1', client_name: 'FCS Inc.',
  },
  {
    id: 'ts-2', clockify_workspace_id: 'ws-1', work_date: `${currentYear}-02-11`,
    project_id: 'p-1', project_name: 'FoodCycleScience', user_id: 'u-1',
    user_name: 'Kalin Tomanov', task_id: 't-1', task_name: 'Development',
    total_minutes: 480, synced_at: now, project_key: 'p-1', user_key: 'u-1',
    task_key: 't-1', client_id: 'c-1', client_name: 'FCS Inc.',
  },
  {
    id: 'ts-3', clockify_workspace_id: 'ws-1', work_date: `${currentYear}-02-10`,
    project_id: 'p-2', project_name: 'Neocurrency', user_id: 'u-2',
    user_name: 'Milen Anastasov', task_id: 't-2', task_name: 'QA Testing',
    total_minutes: 390, synced_at: now, project_key: 'p-2', user_key: 'u-2',
    task_key: 't-2', client_id: 'c-2', client_name: 'Neo Corp',
  },
  {
    id: 'ts-4', clockify_workspace_id: 'ws-1', work_date: `${currentYear}-02-11`,
    project_id: 'p-2', project_name: 'Neocurrency', user_id: 'u-2',
    user_name: 'Milen Anastasov', task_id: 't-2', task_name: 'QA Testing',
    total_minutes: 420, synced_at: now, project_key: 'p-2', user_key: 'u-2',
    task_key: 't-2', client_id: 'c-2', client_name: 'Neo Corp',
  },
  {
    id: 'ts-5', clockify_workspace_id: 'ws-1', work_date: `${currentYear}-02-12`,
    project_id: 'p-1', project_name: 'FoodCycleScience', user_id: 'u-3',
    user_name: 'Matthew Maday', task_id: 't-3', task_name: 'Code Review',
    total_minutes: 150, synced_at: now, project_key: 'p-1', user_key: 'u-3',
    task_key: 't-3', client_id: 'c-1', client_name: 'FCS Inc.',
  },
];

export const mockResources: Resource[] = [
  {
    id: 'r-1', user_id: 'u-1', external_label: 'Kalin Tomanov',
    first_name: 'Kalin', last_name: 'Tomanov', email: 'kalin@example.com',
    teams_account: null, employment_type_id: 'et-1', billing_mode: 'hourly',
    expected_hours: 160, hourly_rate: 60, monthly_cost: null,
    bamboo_employee_id: null, created_at: now, updated_at: now,
  },
  {
    id: 'r-2', user_id: 'u-2', external_label: 'Milen Anastasov',
    first_name: 'Milen', last_name: 'Anastasov', email: 'milen@example.com',
    teams_account: null, employment_type_id: 'et-1', billing_mode: 'hourly',
    expected_hours: 160, hourly_rate: 53, monthly_cost: null,
    bamboo_employee_id: null, created_at: now, updated_at: now,
  },
  {
    id: 'r-3', user_id: 'u-3', external_label: 'Matthew Maday',
    first_name: 'Matthew', last_name: 'Maday', email: 'matt@example.com',
    teams_account: null, employment_type_id: 'et-2', billing_mode: 'monthly',
    expected_hours: 40, hourly_rate: null, monthly_cost: 8000,
    bamboo_employee_id: null, created_at: now, updated_at: now,
  },
];

// ============================================================================
// Molecule Data
// ============================================================================

export const mockTaskSummaries: TaskSummary[] = [
  {
    taskName: 'Development',
    totalMinutes: 990,
    entries: [
      { date: `${currentYear}-02-11`, minutes: 480 },
      { date: `${currentYear}-02-10`, minutes: 510 },
    ],
  },
  {
    taskName: 'Code Review',
    totalMinutes: 150,
    entries: [
      { date: `${currentYear}-02-12`, minutes: 150 },
    ],
  },
];

export const mockResourceSummary: ResourceSummary = {
  userName: 'Kalin Tomanov',
  displayName: 'Kalin Tomanov',
  totalMinutes: 990,
  weeklyMinutes: new Map([['2026-02-10', 990]]),
  tasks: mockTaskSummaries,
};

export const mockProjectSummary: ProjectSummary = {
  projectName: 'FoodCycleScience',
  totalMinutes: 1140,
  resources: [
    mockResourceSummary,
    {
      userName: 'Matthew Maday',
      displayName: 'Matthew Maday',
      totalMinutes: 150,
      weeklyMinutes: new Map([['2026-02-10', 150]]),
      tasks: [mockTaskSummaries[1]],
    },
  ],
  clientId: 'c-1',
  clientName: 'FCS Inc.',
};

// ============================================================================
// Organism Data
// ============================================================================

export const mockHolidays: BulgarianHoliday[] = [
  { id: 'h-1', holiday_name: 'New Year\'s Day', holiday_date: `${currentYear}-01-01`, is_system_generated: true, year: currentYear, created_at: now, updated_at: now },
  { id: 'h-2', holiday_name: 'Liberation Day', holiday_date: `${currentYear}-03-03`, is_system_generated: true, year: currentYear, created_at: now, updated_at: now },
  { id: 'h-3', holiday_name: 'Labour Day', holiday_date: `${currentYear}-05-01`, is_system_generated: true, year: currentYear, created_at: now, updated_at: now },
  { id: 'h-4', holiday_name: 'St. George\'s Day', holiday_date: `${currentYear}-05-06`, is_system_generated: true, year: currentYear, created_at: now, updated_at: now },
  { id: 'h-5', holiday_name: 'Christmas', holiday_date: `${currentYear}-12-25`, is_system_generated: true, year: currentYear, created_at: now, updated_at: now },
];

export const mockTimeOff: EmployeeTimeOff[] = [
  {
    id: 'to-1', bamboo_request_id: 'br-1', bamboo_employee_id: 'be-1',
    resource_id: 'r-1', employee_name: 'Kalin Tomanov', employee_email: 'kalin@example.com',
    time_off_type: 'Vacation', status: 'approved', start_date: `${currentYear}-03-10`,
    end_date: `${currentYear}-03-14`, total_days: 5, notes: null,
    created_at: now, updated_at: now, synced_at: now,
  },
  {
    id: 'to-2', bamboo_request_id: 'br-2', bamboo_employee_id: 'be-2',
    resource_id: 'r-2', employee_name: 'Milen Anastasov', employee_email: 'milen@example.com',
    time_off_type: 'Sick Leave', status: 'approved', start_date: `${currentYear}-02-05`,
    end_date: `${currentYear}-02-06`, total_days: 2, notes: 'Flu',
    created_at: now, updated_at: now, synced_at: now,
  },
];

export const mockAppUsers: AppUser[] = [
  { id: 'au-1', email: 'admin@thebteam.com', display_name: 'Admin User', role: 'admin', is_verified: true, created_at: now, last_sign_in_at: now },
  { id: 'au-2', email: 'matt@thebteam.com', display_name: 'Matthew Maday', role: 'admin', is_verified: true, created_at: now, last_sign_in_at: now },
  { id: 'au-3', email: 'viewer@thebteam.com', display_name: 'View Only', role: 'user', is_verified: false, created_at: now, last_sign_in_at: null },
];

export const mockProjectSummaries: ProjectSummary[] = [
  mockProjectSummary,
  {
    projectName: 'Neocurrency',
    totalMinutes: 810,
    resources: [{
      userName: 'Milen Anastasov',
      displayName: 'Milen Anastasov',
      totalMinutes: 810,
      weeklyMinutes: new Map([['2026-02-10', 810]]),
      tasks: [{
        taskName: 'QA Testing',
        totalMinutes: 810,
        entries: [
          { date: `${currentYear}-02-11`, minutes: 420 },
          { date: `${currentYear}-02-10`, minutes: 390 },
        ],
      }],
    }],
    clientId: 'c-2',
    clientName: 'Neo Corp',
  },
];

export const mockResourceSummaries: ResourceSummary[] = [
  mockResourceSummary,
  {
    userName: 'Milen Anastasov',
    displayName: 'Milen Anastasov',
    totalMinutes: 810,
    weeklyMinutes: new Map([['2026-02-10', 810]]),
    tasks: [{
      taskName: 'QA Testing',
      totalMinutes: 810,
      entries: [
        { date: `${currentYear}-02-11`, minutes: 420 },
        { date: `${currentYear}-02-10`, minutes: 390 },
      ],
    }],
  },
  {
    userName: 'Matthew Maday',
    displayName: 'Matthew Maday',
    totalMinutes: 150,
    weeklyMinutes: new Map([['2026-02-10', 150]]),
    tasks: [mockTaskSummaries[1]],
  },
];

export const mockBurnGridData: Array<{
  name: string;
  hoursByDate: Map<string, number>;
}> = [
  {
    name: 'Kalin Tomanov',
    hoursByDate: new Map([
      [`${currentYear}-02-10`, 8.5],
      [`${currentYear}-02-11`, 8.0],
      [`${currentYear}-02-12`, 7.5],
      [`${currentYear}-02-13`, 8.0],
      [`${currentYear}-02-14`, 6.5],
    ]),
  },
  {
    name: 'Matthew Maday',
    hoursByDate: new Map([
      [`${currentYear}-02-10`, 2.5],
      [`${currentYear}-02-12`, 3.0],
    ]),
  },
  {
    name: 'Milen Anastasov',
    hoursByDate: new Map([
      [`${currentYear}-02-10`, 6.5],
      [`${currentYear}-02-11`, 7.0],
      [`${currentYear}-02-12`, 8.0],
      [`${currentYear}-02-13`, 7.5],
      [`${currentYear}-02-14`, 7.0],
    ]),
  },
];

export const mockUnderHoursResources: UnderHoursResource[] = [
  { userName: 'Matthew Maday', displayName: 'Matthew Maday', actualHours: 5.5, expectedHours: 35.0, deficit: 29.5 },
  { userName: 'Ivan Petrov', displayName: 'Ivan Petrov', actualHours: 22.0, expectedHours: 35.0, deficit: 13.0 },
];
