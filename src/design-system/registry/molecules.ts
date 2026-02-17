import type { DesignSystemEntry } from '../types';

/**
 * Molecule Registry
 *
 * Molecules are collections of atoms organized with a specific intent.
 * Each molecule has a single, focused responsibility that emerges from
 * the combination of its parts.
 */
export const molecules: DesignSystemEntry[] = [
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
  // Editor modals — molecules composed of multiple atom inputs
  {
    name: 'EmployeeEditorModal',
    description: 'Modal form for editing employee data with avatar upload, employment type, and group management.',
    tier: 'molecule',
    filePath: 'src/components/EmployeeEditorModal.tsx',
    composedOf: ['Modal', 'Input', 'Select', 'Button', 'AvatarUpload', 'Toggle'],
    usedIn: ['EmployeeManagementPage'],
  },
  {
    name: 'UserEditorModal',
    description: 'Modal form for creating/editing admin users with role selection and invite toggle.',
    tier: 'molecule',
    filePath: 'src/components/UserEditorModal.tsx',
    composedOf: ['Modal', 'Input', 'Select', 'Button', 'Toggle'],
    usedIn: ['UsersPage'],
  },
  {
    name: 'HolidayEditorModal',
    description: 'Modal form for adding/editing holidays with date picker and name input.',
    tier: 'molecule',
    filePath: 'src/components/HolidayEditorModal.tsx',
    composedOf: ['Modal', 'Input', 'DatePicker', 'Button'],
    usedIn: ['HolidaysPage'],
  },
  {
    name: 'CompanyEditorModal',
    description: 'Modal form for editing company details and managing company groups.',
    tier: 'molecule',
    filePath: 'src/components/CompanyEditorModal.tsx',
    composedOf: ['Modal', 'Input', 'Button'],
    usedIn: ['CompaniesPage'],
  },
  {
    name: 'ProjectEditorModal',
    description: 'Modal form for editing project details and linked properties.',
    tier: 'molecule',
    filePath: 'src/components/ProjectEditorModal.tsx',
    composedOf: ['Modal', 'Input', 'Select', 'Button'],
    usedIn: ['ProjectManagementPage'],
  },
  {
    name: 'RateEditModal',
    description: 'Modal for editing project rates by month with DateCycle navigation and currency input.',
    tier: 'molecule',
    filePath: 'src/components/RateEditModal.tsx',
    composedOf: ['Modal', 'Input', 'Button', 'DateCycle', 'Spinner'],
    usedIn: ['BillingRatesTable'],
  },
  {
    name: 'ProfileEditorModal',
    description: 'Modal for editing user profile with avatar upload and name/email fields.',
    tier: 'molecule',
    filePath: 'src/components/ProfileEditorModal.tsx',
    composedOf: ['Modal', 'Input', 'Button', 'AvatarUpload'],
    usedIn: ['MainHeader'],
  },
  {
    name: 'LegalModal',
    description: 'Modal for displaying and accepting legal documents (Terms, Privacy).',
    tier: 'molecule',
    filePath: 'src/components/LegalModal.tsx',
    composedOf: ['Modal', 'Button', 'Markdown', 'Spinner'],
    usedIn: ['App'],
  },
  {
    name: 'UnderHoursModal',
    description: 'Modal showing resources under target hours with sticky summary MetricCards and accordion list.',
    tier: 'molecule',
    filePath: 'src/components/UnderHoursModal.tsx',
    composedOf: ['Modal', 'MetricCard', 'Card', 'AccordionListTable'],
    usedIn: ['Dashboard'],
  },
  // Group management sections
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
  // Chat molecules
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
