import type { DesignSystemEntry } from '../types';

/**
 * Organism Registry
 *
 * Organisms are collections of molecules (and atoms) composed for a specific
 * on-screen purpose. They are the coherent sections users actually see and
 * interact with on a page.
 *
 * 27 registered organisms.
 */
export const organisms: DesignSystemEntry[] = [
  // ---------------------------------------------------------------------------
  // Dashboard organisms
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Employee organisms
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Rate / Billing organisms
  // ---------------------------------------------------------------------------
  {
    name: 'BillingRatesTable',
    description: 'Grouped accordion table of project rates by company with inline editing, rounding controls, and billing limits.',
    tier: 'organism',
    filePath: 'src/components/BillingRatesTable.tsx',
    composedOf: ['AccordionFlat', 'Badge', 'Checkbox', 'Select', 'DropdownMenu', 'RateEditModal'],
    usedIn: ['RatesPage'],
  },
  {
    name: 'BurnGrid',
    description: 'Monthly burn-rate grid with editable cells, calculated totals, and inline save/cancel.',
    tier: 'organism',
    filePath: 'src/components/atoms/BurnGrid.tsx',
    composedOf: ['Spinner'],
    usedIn: ['BurnPage'],
  },
  {
    name: 'AccordionNested',
    description: 'Three-level accordion hierarchy (project > resource > task) with left border lines.',
    tier: 'organism',
    filePath: 'src/components/AccordionNested.tsx',
    composedOf: ['ChevronIcon'],
    usedIn: ['EmployeePerformance', 'RevenuePage'],
    introducedIn: 'Task 018',
  },
  {
    name: 'AccordionListTable',
    description: 'Accordion with list-table hybrid content for expandable rows with columns.',
    tier: 'organism',
    filePath: 'src/components/AccordionListTable.tsx',
    composedOf: ['ChevronIcon'],
    usedIn: ['UnderHoursModal'],
  },
  {
    name: 'ProjectHierarchyTable',
    description: 'Expandable company > project hierarchy table with hours, revenue columns, and MIN/MAX badges.',
    tier: 'organism',
    filePath: 'src/components/atoms/ProjectHierarchyTable.tsx',
    composedOf: ['ChevronIcon', 'Badge'],
    usedIn: ['RevenuePage'],
  },
  {
    name: 'RevenueTable',
    description: 'Multi-level expandable table showing revenue by company > project > task with sorting and totals.',
    tier: 'organism',
    filePath: 'src/components/atoms/RevenueTable.tsx',
    composedOf: ['ChevronIcon', 'Badge'],
    usedIn: ['RevenuePage'],
  },

  // ---------------------------------------------------------------------------
  // Holiday organisms
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // User organisms
  // ---------------------------------------------------------------------------
  {
    name: 'UserTable',
    description: 'Table of admin users with email, role, status columns, and row-click editing.',
    tier: 'organism',
    filePath: 'src/components/UserTable.tsx',
    composedOf: ['Badge', 'Spinner'],
    usedIn: ['UsersPage'],
  },

  // ---------------------------------------------------------------------------
  // Navigation organisms
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Chat organisms
  // ---------------------------------------------------------------------------
  {
    name: 'AIChatWindow',
    description: 'Floating chat panel with message list, typing indicator, and input area.',
    tier: 'organism',
    filePath: 'src/components/chat/AIChatWindow.tsx',
    composedOf: ['ChatMessage', 'ChatInput', 'TypingIndicator', 'Spinner'],
    usedIn: ['App'],
  },

  // ---------------------------------------------------------------------------
  // Editor modal organisms (multi-section forms with API mutations)
  // ---------------------------------------------------------------------------
  {
    name: 'EmployeeEditorModal',
    description: 'Full-screen modal for editing employee details including personal info, employment type, and group associations.',
    tier: 'organism',
    filePath: 'src/components/EmployeeEditorModal.tsx',
    composedOf: ['Modal', 'Input', 'Select', 'Button', 'Spinner', 'PhysicalPersonGroupSection'],
    usedIn: ['EmployeeManagementPage'],
  },
  {
    name: 'UserEditorModal',
    description: 'Modal for creating/editing admin users with role, status toggles, and resource associations.',
    tier: 'organism',
    filePath: 'src/components/UserEditorModal.tsx',
    composedOf: ['Modal', 'Input', 'Select', 'Toggle', 'Button', 'Spinner', 'UserAssociationsSection'],
    usedIn: ['UsersPage'],
  },
  {
    name: 'HolidayEditorModal',
    description: 'Modal for creating/editing holidays with date picker, type selector, and optional recurrence.',
    tier: 'organism',
    filePath: 'src/components/HolidayEditorModal.tsx',
    composedOf: ['Modal', 'Input', 'Select', 'DatePicker', 'Button', 'Spinner'],
    usedIn: ['HolidaysPage'],
  },
  {
    name: 'CompanyEditorModal',
    description: 'Modal for editing company details and managing company group membership.',
    tier: 'organism',
    filePath: 'src/components/CompanyEditorModal.tsx',
    composedOf: ['Modal', 'Input', 'Button', 'Spinner', 'CompanyGroupSection'],
    usedIn: ['CompanyManagementPage'],
  },
  {
    name: 'ProjectEditorModal',
    description: 'Modal for editing project settings including target hours and project group membership.',
    tier: 'organism',
    filePath: 'src/components/ProjectEditorModal.tsx',
    composedOf: ['Modal', 'Button', 'Spinner', 'ProjectGroupSection'],
    usedIn: ['ProjectManagementPage'],
  },
  {
    name: 'RateEditModal',
    description: 'Modal for editing project billing rates with month navigation, rate input, and billing limits.',
    tier: 'organism',
    filePath: 'src/components/RateEditModal.tsx',
    composedOf: ['Modal', 'Input', 'Select', 'DateCycle', 'Button', 'Spinner'],
    usedIn: ['BillingRatesTable'],
  },
  {
    name: 'ProfileEditorModal',
    description: 'Modal for editing user profile with avatar upload and personal details form.',
    tier: 'organism',
    filePath: 'src/components/ProfileEditorModal.tsx',
    composedOf: ['Modal', 'Input', 'AvatarUpload', 'Button', 'Spinner'],
    usedIn: ['MainHeader'],
  },
  {
    name: 'LegalModal',
    description: 'Full-screen modal displaying legal documents (Terms of Service, Privacy Policy) with Markdown rendering.',
    tier: 'organism',
    filePath: 'src/components/LegalModal.tsx',
    composedOf: ['Modal', 'Markdown', 'Spinner'],
    usedIn: ['Footer', 'LoginPage'],
  },
  {
    name: 'UnderHoursModal',
    description: 'Modal showing employees under target hours with accordion breakdown by employee and project.',
    tier: 'organism',
    filePath: 'src/components/UnderHoursModal.tsx',
    composedOf: ['Modal', 'MetricCard', 'AccordionListTable', 'Card', 'Spinner'],
    usedIn: ['StatsOverview'],
  },
];
