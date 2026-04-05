import type { DesignSystemEntry } from '../types';

/**
 * Molecule Registry
 *
 * Molecules are collections of atoms organized with a specific intent.
 * Each molecule has a single, focused responsibility that emerges from
 * the combination of its parts.
 *
 * 20 registered molecules.
 */
export const molecules: DesignSystemEntry[] = [
  // ---------------------------------------------------------------------------
  // Navigation & date controls
  // ---------------------------------------------------------------------------
  {
    name: 'DateCycle',
    description: 'Month navigation control with left/right chevrons and a centered date label.',
    tier: 'molecule',
    filePath: 'src/components/molecules/DateCycle.tsx',
    composedOf: ['ChevronIcon'],
    usedIn: ['RateEditModal'],
  },
  {
    name: 'RangeSelector',
    description: 'Date range control with mode buttons (month/quarter/ytd/custom), navigation, and optional export dropdown.',
    tier: 'molecule',
    filePath: 'src/components/RangeSelector.tsx',
    composedOf: ['Button', 'DropdownMenu', 'ChevronIcon'],
    usedIn: [
      'Dashboard', 'EmployeesPage', 'RatesPage', 'RevenuePage',
      'BurnPage', 'EOMReportsPage',
    ],
  },
  {
    name: 'DateRangeFilter',
    description: 'Month navigation filter with previous/next buttons and formatted date display.',
    tier: 'molecule',
    filePath: 'src/components/DateRangeFilter.tsx',
    composedOf: ['Button', 'DatePicker'],
    usedIn: ['BillingsPage'],
  },

  // ---------------------------------------------------------------------------
  // Composite inputs (atoms that compose other atoms)
  // ---------------------------------------------------------------------------
  {
    name: 'MetricCard',
    description: 'Stat display card with title, value, optional status dot, loading state, and action button.',
    tier: 'molecule',
    filePath: 'src/components/MetricCard.tsx',
    composedOf: ['Card'],
    usedIn: [
      'StatsOverview', 'EmployeesPage', 'EmployeeManagementPage',
      'RatesPage', 'HolidaysPage', 'UsersPage', 'InvestorDashboardPage',
      'UnderHoursModal',
    ],
  },
  {
    name: 'DatePicker',
    description: 'Date input with inline calendar dropdown, month/year navigation, and keyboard support.',
    tier: 'molecule',
    filePath: 'src/components/DatePicker.tsx',
    composedOf: ['ChevronIcon'],
    usedIn: ['HolidayEditorModal', 'BillingsPage'],
    introducedIn: 'Task 018',
  },
  {
    name: 'MonthPicker',
    description: 'Month-level date picker for selecting year/month combinations.',
    tier: 'molecule',
    filePath: 'src/components/MonthPicker.tsx',
    composedOf: ['ChevronIcon'],
    usedIn: ['BillingsPage'],
  },
  {
    name: 'DropdownMenu',
    description: 'Context menu with icon-button or text trigger, positioned dynamically.',
    tier: 'molecule',
    filePath: 'src/components/DropdownMenu.tsx',
    composedOf: ['Button'],
    usedIn: ['RangeSelector', 'BillingRatesTable'],
  },
  {
    name: 'AvatarUpload',
    description: 'Avatar with hover overlay for uploading and cropping a new image.',
    tier: 'molecule',
    filePath: 'src/components/AvatarUpload.tsx',
    composedOf: ['Avatar'],
    usedIn: ['ProfileEditorModal'],
  },

  // ---------------------------------------------------------------------------
  // Accordion molecules (compose atoms into structured expand/collapse patterns)
  // ---------------------------------------------------------------------------
  {
    name: 'AccordionFlat',
    description: 'Two-level accordion with tabular content, column headers, groupable rows, and footer.',
    tier: 'molecule',
    filePath: 'src/components/AccordionFlat.tsx',
    composedOf: ['ChevronIcon'],
    usedIn: ['BillingRatesTable'],
    introducedIn: 'Task 018',
  },

  // ---------------------------------------------------------------------------
  // Chart molecules (compose chart atoms with data formatting)
  // ---------------------------------------------------------------------------
  {
    name: 'PieChartAtom',
    description: 'Donut/pie chart for data distribution using Recharts.',
    tier: 'molecule',
    filePath: 'src/components/atoms/charts/PieChartAtom.tsx',
    composedOf: [],
    usedIn: ['DashboardChartsRow'],
  },
  {
    name: 'LineGraphAtom',
    description: 'Line chart for cumulative Target/Budget/Revenue trends using Recharts.',
    tier: 'molecule',
    filePath: 'src/components/atoms/charts/LineGraphAtom.tsx',
    composedOf: [],
    usedIn: ['DashboardChartsRow', 'InvestorDashboardPage'],
  },

  // ---------------------------------------------------------------------------
  // Data display molecules
  // ---------------------------------------------------------------------------
  {
    name: 'ResourceRow',
    description: 'Expandable table row for a single employee with chevron toggle and nested project details.',
    tier: 'molecule',
    filePath: 'src/components/ResourceRow.tsx',
    composedOf: ['ChevronIcon'],
    usedIn: ['ResourceTable'],
  },
  {
    name: 'ProjectCard',
    description: 'Summary card for a project showing resource count, total hours, and details link.',
    tier: 'molecule',
    filePath: 'src/components/ProjectCard.tsx',
    composedOf: ['Card'],
    usedIn: ['ProjectsPage'],
  },
  {
    name: 'TaskList',
    description: 'Grouped list of time entries organized by task with hours and date details.',
    tier: 'molecule',
    filePath: 'src/components/TaskList.tsx',
    usedIn: ['ResourceRow'],
  },

  // ---------------------------------------------------------------------------
  // Group management sections
  // ---------------------------------------------------------------------------
  {
    name: 'CompanyGroupSection',
    description: 'Section for managing company group membership with add/remove controls.',
    tier: 'molecule',
    filePath: 'src/components/CompanyGroupSection.tsx',
    composedOf: ['Select', 'Button', 'Spinner'],
    usedIn: ['CompanyEditorModal'],
  },
  {
    name: 'ProjectGroupSection',
    description: 'Section for managing project group membership.',
    tier: 'molecule',
    filePath: 'src/components/ProjectGroupSection.tsx',
    composedOf: ['Select', 'Button', 'Spinner'],
    usedIn: ['ProjectEditorModal'],
  },
  {
    name: 'PhysicalPersonGroupSection',
    description: 'Section for managing physical person (employee) group membership.',
    tier: 'molecule',
    filePath: 'src/components/PhysicalPersonGroupSection.tsx',
    composedOf: ['Select', 'Button', 'Spinner'],
    usedIn: ['EmployeeEditorModal'],
  },
  {
    name: 'UserAssociationsSection',
    description: 'Section showing resource associations linked to a user account.',
    tier: 'molecule',
    filePath: 'src/components/UserAssociationsSection.tsx',
    composedOf: ['Button', 'Spinner'],
    usedIn: ['UserEditorModal'],
  },

  // ---------------------------------------------------------------------------
  // Chat molecules
  // ---------------------------------------------------------------------------
  {
    name: 'ChatMessage',
    description: 'Single chat message bubble with user/AI styling and Markdown rendering.',
    tier: 'molecule',
    filePath: 'src/components/chat/ChatMessage.tsx',
    composedOf: ['Markdown', 'Avatar'],
    usedIn: ['AIChatWindow'],
  },
  {
    name: 'ChatInput',
    description: 'Text input area with send button for composing chat messages.',
    tier: 'molecule',
    filePath: 'src/components/chat/ChatInput.tsx',
    composedOf: ['Button'],
    usedIn: ['AIChatWindow'],
  },
];
