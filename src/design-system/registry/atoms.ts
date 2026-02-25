import type { DesignSystemEntry } from '../types';

/**
 * Atom Registry
 *
 * Atoms are the smallest, indivisible UI elements. They are single-purpose
 * primitives that do not compose other design system components. They exist
 * to be composed into molecules and organisms.
 *
 * 22 registered atoms.
 */
export const atoms: DesignSystemEntry[] = [
  // ---------------------------------------------------------------------------
  // Form primitives
  // ---------------------------------------------------------------------------
  {
    name: 'Button',
    description: 'Interactive button with primary, secondary, ghost, and danger variants in sm/md/lg sizes.',
    tier: 'atom',
    filePath: 'src/components/Button.tsx',
    usedIn: [
      'StatsOverview', 'Dashboard', 'Modal', 'RangeSelector',
      'EmployeeEditorModal', 'UserEditorModal', 'HolidayEditorModal',
      'CompanyEditorModal', 'ProjectEditorModal', 'ProfileEditorModal',
      'RateEditModal', 'LegalModal', 'HolidaysPage', 'UsersPage',
    ],
    introducedIn: 'Task 014',
  },
  {
    name: 'Input',
    description: 'Form input with label, error, helperText, startAddon/endAddon, and sm/md/lg sizes.',
    tier: 'atom',
    filePath: 'src/components/Input.tsx',
    usedIn: [
      'EmployeeEditorModal', 'UserEditorModal', 'HolidayEditorModal',
      'CompanyEditorModal', 'ProjectEditorModal', 'RateEditModal',
    ],
    introducedIn: 'Task 015',
  },
  {
    name: 'Select',
    description: 'Dropdown select with search, custom rendering, and keyboard navigation.',
    tier: 'atom',
    filePath: 'src/components/Select.tsx',
    usedIn: [
      'EmployeeEditorModal', 'HolidaysPage', 'RangeSelector',
      'BillingRatesTable', 'BillingsPage',
    ],
  },
  {
    name: 'MultiSelect',
    description: 'Multi-selection dropdown with checkboxes and badge count.',
    tier: 'atom',
    filePath: 'src/components/MultiSelect.tsx',
    usedIn: ['BillingsPage'],
  },
  {
    name: 'Checkbox',
    description: 'Checkbox input with label, indeterminate state, and size variants.',
    tier: 'atom',
    filePath: 'src/components/Checkbox.tsx',
    usedIn: ['BillingRatesTable'],
    introducedIn: 'Task 041',
  },
  {
    name: 'Toggle',
    description: 'Boolean switch with label and optional description text.',
    tier: 'atom',
    filePath: 'src/components/Toggle.tsx',
    usedIn: ['UserEditorModal'],
    introducedIn: 'Task 019',
  },

  // ---------------------------------------------------------------------------
  // Containers & feedback
  // ---------------------------------------------------------------------------
  {
    name: 'Card',
    description: 'Container with default, elevated, bordered, and subtle variants; none/sm/md/lg padding.',
    tier: 'atom',
    filePath: 'src/components/Card.tsx',
    usedIn: [
      'Dashboard', 'DashboardChartsRow', 'UnderHoursModal',
      'InvestorDashboardPage', 'FormulasPage',
    ],
    introducedIn: 'Task 015',
  },
  {
    name: 'Badge',
    description: 'Status label with default, success, warning, error, and info variants in sm/md sizes.',
    tier: 'atom',
    filePath: 'src/components/Badge.tsx',
    usedIn: [
      'BillingRatesTable', 'ResourceTable', 'EmployeePerformance',
      'HolidayCalendar',
    ],
    introducedIn: 'Task 015',
  },
  {
    name: 'Spinner',
    description: 'Animated loading indicator in sm/md/lg sizes with default and white color options.',
    tier: 'atom',
    filePath: 'src/components/Spinner.tsx',
    usedIn: [
      'Dashboard', 'EmployeesPage', 'RatesPage', 'InvestorDashboardPage',
      'HolidaysPage', 'BillingsPage', 'RevenuePage', 'EOMReportsPage',
    ],
    introducedIn: 'Task 014',
  },
  {
    name: 'Modal',
    description: 'Dialog overlay with header, scrollable body, optional sticky header, and footer actions.',
    tier: 'atom',
    filePath: 'src/components/Modal.tsx',
    usedIn: [
      'EmployeeEditorModal', 'UserEditorModal', 'HolidayEditorModal',
      'CompanyEditorModal', 'ProjectEditorModal', 'RateEditModal',
      'ProfileEditorModal', 'LegalModal', 'UnderHoursModal',
    ],
  },
  {
    name: 'Alert',
    description: 'Subtle message box with error or info icon variants.',
    tier: 'atom',
    filePath: 'src/components/Alert.tsx',
    usedIn: ['RatesPage', 'LoginPage'],
    introducedIn: 'Task 019',
  },
  {
    name: 'Accordion',
    description: 'Expandable section with chevron toggle and header/content areas.',
    tier: 'atom',
    filePath: 'src/components/Accordion.tsx',
    usedIn: ['DiagnosticsPage'],
    introducedIn: 'Task 018',
  },

  // ---------------------------------------------------------------------------
  // Icons & indicators
  // ---------------------------------------------------------------------------
  {
    name: 'Avatar',
    description: 'Circular user avatar with image, initials fallback, and size variants.',
    tier: 'atom',
    filePath: 'src/components/Avatar.tsx',
    usedIn: ['MainHeader', 'ProfileEditorModal'],
  },
  {
    name: 'ChevronIcon',
    description: 'Directional chevron SVG with left/right/up/down rotation and animated transitions.',
    tier: 'atom',
    filePath: 'src/components/ChevronIcon.tsx',
    usedIn: [
      'DateCycle', 'Accordion', 'AccordionNested', 'AccordionFlat',
      'AccordionListTable',
    ],
  },
  {
    name: 'Icon',
    description: 'Generic SVG icon wrapper for inline icons.',
    tier: 'atom',
    filePath: 'src/components/Icon.tsx',
    usedIn: ['Alert'],
  },
  {
    name: 'NavItem',
    description: 'Navigation link with active indicator bar and hover transition.',
    tier: 'atom',
    filePath: 'src/components/NavItem.tsx',
    usedIn: ['MainHeader'],
  },
  {
    name: 'Markdown',
    description: 'Renders Markdown-formatted text as styled HTML.',
    tier: 'atom',
    filePath: 'src/components/Markdown.tsx',
    usedIn: ['ChatMessage', 'LegalPage'],
  },
  {
    name: 'TypingIndicator',
    description: 'Animated bouncing dots indicating that AI is typing a response.',
    tier: 'atom',
    filePath: 'src/components/TypingIndicator.tsx',
    usedIn: ['AIChatWindow'],
  },
  {
    name: 'AIChatButton',
    description: 'Floating action button that toggles the AI chat window.',
    tier: 'atom',
    filePath: 'src/components/chat/AIChatButton.tsx',
    usedIn: ['App'],
  },

  // ---------------------------------------------------------------------------
  // Chart primitives
  // ---------------------------------------------------------------------------
  {
    name: 'BarChartAtom',
    description: 'Horizontal bar chart for resource hours distribution using Recharts.',
    tier: 'atom',
    filePath: 'src/components/atoms/charts/BarChartAtom.tsx',
    usedIn: ['DashboardChartsRow'],
  },
  {
    name: 'CAGRChartAtom',
    description: 'Compound Annual Growth Rate bar chart visualization.',
    tier: 'atom',
    filePath: 'src/components/atoms/charts/CAGRChartAtom.tsx',
    usedIn: ['DashboardChartsRow'],
  },
  {
    name: 'DailyHoursChart',
    description: 'Stacked bar chart showing daily hours by employee across a month.',
    tier: 'atom',
    filePath: 'src/components/atoms/charts/DailyHoursChart.tsx',
    usedIn: ['Dashboard'],
  },
];
