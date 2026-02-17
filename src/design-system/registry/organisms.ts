import type { DesignSystemEntry } from '../types';

/**
 * Organism Registry
 *
 * Organisms are collections of molecules (and atoms) composed for a specific
 * on-screen purpose. They are the coherent sections users actually see and
 * interact with on a page.
 */
export const organisms: DesignSystemEntry[] = [
  // ----- Dashboard organisms -----
  {
    name: 'StatsOverview',
    description: 'Row of MetricCards showing total hours, utilization, revenue status, project/resource counts, and under-target alerts.',
    tier: 'organism',
    filePath: 'src/components/StatsOverview.tsx',
    composedOf: ['MetricCard'],
    usedIn: ['Dashboard'],
  },
  {
    name: 'DashboardChartsRow',
    description: 'Two-column responsive grid displaying pie charts, bar charts, line graphs, and CAGR visualizations.',
    tier: 'organism',
    filePath: 'src/components/DashboardChartsRow.tsx',
    composedOf: ['Card', 'PieChartAtom', 'BarChartAtom', 'LineGraphAtom', 'CAGRChartAtom', 'Spinner'],
    usedIn: ['Dashboard'],
  },

  // ----- Employee organisms -----
  {
    name: 'EmployeePerformance',
    description: 'Expandable employee table showing hours and revenue by company > project > task with sorting.',
    tier: 'organism',
    filePath: 'src/components/EmployeePerformance.tsx',
    composedOf: ['AccordionNested', 'Badge'],
    usedIn: ['EmployeesPage'],
  },
  {
    name: 'ResourceTable',
    description: 'Sortable table of employee records with name, email, employment type, and status columns.',
    tier: 'organism',
    filePath: 'src/components/ResourceTable.tsx',
    composedOf: ['Avatar', 'Badge', 'Spinner'],
    usedIn: ['EmployeeManagementPage'],
  },
  {
    name: 'BambooEmployeePanel',
    description: 'Panel showing BambooHR employee sync status with loading skeleton and match indicators.',
    tier: 'organism',
    filePath: 'src/components/BambooEmployeePanel.tsx',
    composedOf: ['Badge', 'Spinner'],
    usedIn: ['EmployeeManagementPage'],
  },

  // ----- Rate / Billing organisms -----
  {
    name: 'BillingRatesTable',
    description: 'Grouped accordion table of project rates by company with inline editing, rounding controls, and billing limits.',
    tier: 'organism',
    filePath: 'src/components/BillingRatesTable.tsx',
    composedOf: ['AccordionFlat', 'Badge', 'Checkbox', 'Select', 'DropdownMenu', 'RateEditModal'],
    usedIn: ['RatesPage'],
  },

  // ----- Holiday organisms -----
  {
    name: 'HolidayTable',
    description: 'Table of holidays with name, date, type columns, and edit/delete actions.',
    tier: 'organism',
    filePath: 'src/components/HolidayTable.tsx',
    composedOf: ['Badge', 'Spinner'],
    usedIn: ['HolidaysPage'],
  },
  {
    name: 'HolidayCalendar',
    description: 'Monthly calendar grid highlighting holidays and employee time-off days with hover tooltips.',
    tier: 'organism',
    filePath: 'src/components/HolidayCalendar.tsx',
    composedOf: ['Badge'],
    usedIn: ['HolidaysPage'],
  },
  {
    name: 'EmployeeTimeOffList',
    description: 'Table of employee time-off records with name, dates, type, and status columns.',
    tier: 'organism',
    filePath: 'src/components/EmployeeTimeOffList.tsx',
    composedOf: ['Badge', 'Spinner'],
    usedIn: ['HolidaysPage'],
  },

  // ----- User organisms -----
  {
    name: 'UserTable',
    description: 'Table of admin users with email, role, status columns, and row-click editing.',
    tier: 'organism',
    filePath: 'src/components/UserTable.tsx',
    composedOf: ['Badge', 'Spinner'],
    usedIn: ['UsersPage'],
  },

  // ----- Navigation organisms -----
  {
    name: 'MainHeader',
    description: 'Top navigation bar with logo, nav items, profile avatar dropdown, and mobile menu.',
    tier: 'organism',
    filePath: 'src/components/MainHeader.tsx',
    composedOf: ['NavItem', 'Avatar', 'DropdownMenu', 'ProfileEditorModal'],
    usedIn: ['App'],
  },
  {
    name: 'Footer',
    description: 'Page footer with navigation links, legal links, and copyright.',
    tier: 'organism',
    filePath: 'src/components/Footer.tsx',
    composedOf: [],
    usedIn: ['App'],
  },

  // ----- Chat organisms -----
  {
    name: 'AIChatWindow',
    description: 'Floating chat panel with message list, typing indicator, and input area.',
    tier: 'organism',
    filePath: 'src/components/chat/AIChatWindow.tsx',
    composedOf: ['ChatMessage', 'ChatInput', 'TypingIndicator', 'Spinner'],
    usedIn: ['App'],
  },
  {
    name: 'AIChatButton',
    description: 'Floating action button that toggles the AI chat window.',
    tier: 'organism',
    filePath: 'src/components/chat/AIChatButton.tsx',
    composedOf: [],
    usedIn: ['App'],
  },

  // ----- Filtering organisms -----
  {
    name: 'DateRangeFilter',
    description: 'Month navigation filter with previous/next buttons and formatted date display.',
    tier: 'organism',
    filePath: 'src/components/DateRangeFilter.tsx',
    composedOf: ['Button', 'DatePicker'],
    usedIn: ['BillingsPage'],
  },
];
