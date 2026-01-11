/**
 * Style Review Surface - Design System Documentation
 *
 * This page displays all official components and design tokens for
 * visual reference. Accessible via the Docs dropdown in the main header.
 */

import { useState } from 'react';
import { MeshGradientBackground } from '../patterns/MeshGradientBackground';
import { TypographyPreview } from '../Typography';
import { Modal } from '../../components/Modal';
import { Select } from '../../components/Select';
import { Avatar } from '../../components/Avatar';
import { MetricCard } from '../../components/MetricCard';
import { DropdownMenu } from '../../components/DropdownMenu';
import { Button } from '../../components/Button';
import { Spinner } from '../../components/Spinner';
import { Input } from '../../components/Input';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { DatePicker } from '../../components/DatePicker';
import { HolidayCalendar } from '../../components/HolidayCalendar';
import { AccordionNested } from '../../components/AccordionNested';
import type { AccordionNestedLevel2Item } from '../../components/AccordionNested';
import { AccordionFlat } from '../../components/AccordionFlat';
import type { AccordionFlatColumn, AccordionFlatRow, AccordionFlatFooterCell } from '../../components/AccordionFlat';

type Section = 'tokens' | 'typography' | 'atoms' | 'molecules' | 'patterns';

interface StyleReviewPageProps {
  onClose: () => void;
  initialSection?: Section;
}

export function StyleReviewPage({ onClose, initialSection = 'tokens' }: StyleReviewPageProps) {
  const [activeSection, setActiveSection] = useState<Section>(initialSection);
  const [showBackground, setShowBackground] = useState(false);

  const sections: { id: Section; label: string }[] = [
    { id: 'tokens', label: 'Design Tokens' },
    { id: 'typography', label: 'Typography' },
    { id: 'atoms', label: 'Atoms' },
    { id: 'molecules', label: 'Molecules' },
    { id: 'patterns', label: 'Global Patterns' },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-white border-b border-vercel-gray-100">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-vercel-gray-600">
                Design System
              </h1>
              <p className="text-sm text-vercel-gray-400">
                Components and style tokens reference
              </p>
            </div>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-1 mt-4 border-b border-vercel-gray-100 -mb-px">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeSection === section.id
                    ? 'text-vercel-gray-600 border-vercel-gray-600'
                    : 'text-vercel-gray-400 border-transparent hover:text-vercel-gray-600'
                }`}
              >
                {section.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {activeSection === 'tokens' && <TokensSection />}
        {activeSection === 'typography' && <TypographyPreview showAll />}
        {activeSection === 'atoms' && <AtomsSection />}
        {activeSection === 'molecules' && <MoleculesSection />}
        {activeSection === 'patterns' && (
          <PatternsSection showBackground={showBackground} setShowBackground={setShowBackground} />
        )}
      </div>

      {/* Background preview overlay */}
      {showBackground && <MeshGradientBackground />}
    </div>
  );
}

// Design Tokens Section
function TokensSection() {
  const colors = {
    'Core Neutrals': [
      { name: 'Black', value: '#000000', token: '--color-black' },
      { name: 'White', value: '#FFFFFF', token: '--color-white' },
      { name: 'Gray 50 (Vercel)', value: '#FAFAFA', token: '--color-vercel-gray-50' },
      { name: 'Gray 100 (Vercel)', value: '#EAEAEA', token: '--color-vercel-gray-100' },
      { name: 'Gray 200 (Vercel)', value: '#999999', token: '--color-vercel-gray-200' },
      { name: 'Gray 400', value: '#666666', token: '--color-gray-400' },
      { name: 'Gray 500', value: '#333333', token: '--color-gray-500' },
    ],
    'Semantic - Error': [
      { name: 'Error', value: '#EE0000', token: '--color-error' },
      { name: 'Error Hover', value: '#CC0000', token: '--color-error-hover' },
      { name: 'Error Light', value: '#FEF2F2', token: '--color-error-light' },
    ],
    'Semantic - Success': [
      { name: 'Success', value: '#50E3C2', token: '--color-success' },
      { name: 'Success Light', value: '#F0FDF4', token: '--color-success-light' },
    ],
    'Semantic - Warning': [
      { name: 'Warning', value: '#F5A623', token: '--color-warning' },
      { name: 'Warning Light', value: '#FFF7ED', token: '--color-warning-light' },
    ],
    'Brand Accent': [
      { name: 'Indigo', value: '#667eea', token: '--color-brand-indigo' },
      { name: 'Purple', value: '#764ba2', token: '--color-brand-purple' },
      { name: 'The B Team', value: '#E50A73', token: '--color-bteam-brand' },
      { name: 'The B Team Light', value: '#FDF2F6', token: '--color-bteam-brand-light' },
    ],
  };

  const typography = [
    { name: 'Text 2XS', class: 'text-[10px]', size: '10px' },
    { name: 'Text XS', class: 'text-xs', size: '12px' },
    { name: 'Text SM', class: 'text-sm', size: '14px' },
    { name: 'Text Base', class: 'text-base', size: '16px' },
    { name: 'Text LG', class: 'text-lg', size: '18px' },
    { name: 'Text XL', class: 'text-xl', size: '20px' },
    { name: 'Text 2XL', class: 'text-2xl', size: '24px' },
  ];

  const spacing = [1, 2, 3, 4, 6, 8, 12, 16];

  return (
    <div className="space-y-12">
      {/* Colors */}
      <div>
        <h2 className="text-lg font-semibold text-vercel-gray-600 mb-6">Color Palette</h2>
        {Object.entries(colors).map(([category, palette]) => (
          <div key={category} className="mb-8">
            <h3 className="text-sm font-medium text-vercel-gray-400 mb-3">{category}</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
              {palette.map((color) => (
                <div key={color.name} className="space-y-2">
                  <div
                    className="w-full h-16 rounded-lg border border-vercel-gray-100"
                    style={{ backgroundColor: color.value }}
                  />
                  <div>
                    <p className="text-xs font-medium text-vercel-gray-600">{color.name}</p>
                    <p className="text-2xs text-vercel-gray-400 font-mono">{color.value}</p>
                    <p className="text-2xs text-vercel-gray-200 font-mono">{color.token}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Typography */}
      <div>
        <h2 className="text-lg font-semibold text-vercel-gray-600 mb-6">Typography Scale</h2>
        <div className="space-y-4">
          {typography.map((type) => (
            <div key={type.name} className="flex items-center gap-4 p-4 border border-vercel-gray-100 rounded-lg">
              <div className="w-24 text-xs text-vercel-gray-400">
                <p className="font-medium">{type.name}</p>
                <p className="font-mono">{type.size}</p>
              </div>
              <p className={type.class + ' text-vercel-gray-600'}>
                The quick brown fox jumps over the lazy dog
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Spacing */}
      <div>
        <h2 className="text-lg font-semibold text-vercel-gray-600 mb-6">Spacing Scale</h2>
        <div className="flex flex-wrap gap-4">
          {spacing.map((space) => (
            <div key={space} className="text-center">
              <div
                className="bg-brand-indigo rounded"
                style={{ width: space * 4, height: space * 4 }}
              />
              <p className="text-xs text-vercel-gray-400 mt-2">{space}</p>
              <p className="text-2xs text-vercel-gray-200">{space * 4}px</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Atoms Section
function AtomsSection() {
  const [modalOpen, setModalOpen] = useState(false);
  const [datePickerValue, setDatePickerValue] = useState('');

  // Sample data for AccordionFlat demo
  const sampleFlatColumns: AccordionFlatColumn[] = [
    { key: 'project', label: 'Project', align: 'left' },
    { key: 'hours', label: 'Hours', align: 'right' },
    { key: 'rate', label: 'Rate', align: 'right' },
    { key: 'revenue', label: 'Revenue', align: 'right' },
  ];

  const sampleFlatRows: AccordionFlatRow[] = [
    {
      id: 'fcs',
      cells: {
        project: <span className="text-vercel-gray-600">FoodCycleScience</span>,
        hours: <span className="text-vercel-gray-400">64.5</span>,
        rate: <span className="text-vercel-gray-600">$60.00</span>,
        revenue: <span className="font-medium text-vercel-gray-600">$3,870.00</span>,
      },
    },
    {
      id: 'neo',
      cells: {
        project: <span className="text-vercel-gray-600">Neocurrency</span>,
        hours: <span className="text-vercel-gray-400">43.8</span>,
        rate: <span className="text-vercel-gray-600">$53.00</span>,
        revenue: <span className="font-medium text-vercel-gray-600">$2,318.75</span>,
      },
    },
  ];

  const sampleFlatFooter: AccordionFlatFooterCell[] = [
    { columnKey: 'project', content: 'Total' },
    { columnKey: 'hours', content: '108.3' },
    { columnKey: 'rate', content: null },
    { columnKey: 'revenue', content: '$6,188.75' },
  ];

  // Sample data for AccordionNested demo
  const sampleNestedItems: AccordionNestedLevel2Item[] = [
    {
      id: 'kalin',
      label: 'Kalin Tomanov',
      value: '40.0h',
      children: [
        {
          id: 'kalin-task-1',
          label: '(no description)',
          value: '40.0h',
          details: ['1/9: 8.5h', '1/8: 7.8h', '1/7: 8.3h', '1/6: 7.5h', '1/5: 8.0h'],
        },
      ],
    },
    {
      id: 'milen',
      label: 'Milen Manastasov',
      value: '22.0h',
      children: [
        {
          id: 'milen-task-1',
          label: 'Development tasks',
          value: '22.0h',
          details: ['1/9: 5.5h', '1/8: 8.0h', '1/7: 8.5h'],
        },
      ],
    },
    {
      id: 'matthew',
      label: 'Matthew Maday',
      value: '2.5h',
      children: [
        {
          id: 'matthew-task-1',
          label: 'Code review',
          value: '2.5h',
          details: ['1/9: 2.5h'],
        },
      ],
    },
  ];

  // Sample holidays for the HolidayCalendar demo
  const currentYear = new Date().getFullYear();
  const now = new Date().toISOString();
  const sampleHolidays = [
    { id: '1', holiday_date: `${currentYear}-01-01`, holiday_name: 'New Year', is_system_generated: true, year: currentYear, created_at: now, updated_at: now },
    { id: '2', holiday_date: `${currentYear}-03-03`, holiday_name: 'Liberation Day', is_system_generated: true, year: currentYear, created_at: now, updated_at: now },
    { id: '3', holiday_date: `${currentYear}-12-25`, holiday_name: 'Christmas', is_system_generated: true, year: currentYear, created_at: now, updated_at: now },
  ];

  return (
    <div className="space-y-12">
      {/* Official Atoms */}
      <div>
        <h2 className="text-lg font-semibold text-vercel-gray-600 mb-6">Official Atoms</h2>

        {/* Button */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">Button</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/Button.tsx</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="primary" size="sm">Small</Button>
            <Button variant="primary" size="lg">Large</Button>
            <Button variant="primary" disabled>Disabled</Button>
          </div>
        </div>

        {/* Spinner */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">Spinner</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/Spinner.tsx</p>
          </div>
          <div className="flex gap-6 items-center">
            <div className="text-center">
              <Spinner size="sm" />
              <p className="text-[10px] text-vercel-gray-400 mt-2">Small</p>
            </div>
            <div className="text-center">
              <Spinner size="md" />
              <p className="text-[10px] text-vercel-gray-400 mt-2">Medium</p>
            </div>
            <div className="text-center">
              <Spinner size="lg" />
              <p className="text-[10px] text-vercel-gray-400 mt-2">Large</p>
            </div>
            <div className="text-center bg-vercel-gray-600 p-4 rounded">
              <Spinner size="md" color="white" />
              <p className="text-[10px] text-white mt-2">White</p>
            </div>
          </div>
        </div>

        {/* Input */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">Input</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/Input.tsx</p>
          </div>
          <div className="grid gap-4 max-w-md">
            <Input label="Default Input" placeholder="Enter text..." />
            <Input label="With Error" error="This field is required" />
            <Input label="With Helper Text" helperText="Optional helper text" />
            <Input label="Small Size" size="sm" placeholder="Small input" />
            <Input label="Large Size" size="lg" placeholder="Large input" />
            <Input label="Disabled" disabled value="Disabled input" />
          </div>
        </div>

        {/* Card */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">Card</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/Card.tsx</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Card variant="default">
              <p className="text-sm text-vercel-gray-600">Default Card</p>
            </Card>
            <Card variant="elevated">
              <p className="text-sm text-vercel-gray-600">Elevated Card</p>
            </Card>
            <Card variant="bordered">
              <p className="text-sm text-vercel-gray-600">Bordered Card</p>
            </Card>
            <Card variant="subtle">
              <p className="text-sm text-vercel-gray-600">Subtle Card</p>
            </Card>
          </div>
        </div>

        {/* Badge */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">Badge</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/Badge.tsx</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="default">Default</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="error">Error</Badge>
            <Badge variant="info">Info</Badge>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <Badge variant="default" size="md">Medium Default</Badge>
            <Badge variant="success" size="md">Medium Success</Badge>
          </div>
        </div>

        {/* DatePicker - Calendar Dropdown */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-medium text-vercel-gray-600">DatePicker (Dropdown Calendar)</h3>
              <p className="text-xs text-vercel-gray-400">Component: src/components/DatePicker.tsx</p>
            </div>
          </div>
          <div className="max-w-xs">
            <DatePicker
              value={datePickerValue}
              onChange={setDatePickerValue}
              placeholder="Select a date"
            />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Dropdown calendar with month navigation, today indicator (circle with 1px border), clear/today buttons.
            </p>
          </div>
        </div>

        {/* HolidayCalendar - Inline Calendar */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-medium text-vercel-gray-600">HolidayCalendar (Inline Calendar)</h3>
              <p className="text-xs text-vercel-gray-400">Component: src/components/HolidayCalendar.tsx</p>
            </div>
          </div>
          <div className="max-w-sm">
            <HolidayCalendar
              holidays={sampleHolidays}
              year={new Date().getFullYear()}
              onDateClick={() => {}}
            />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Inline month view with holiday highlighting, today indicator (circle with 1px border), legend, month navigation.
            </p>
          </div>
        </div>

        {/* Avatar */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-4">Avatar</h3>
          <p className="text-xs text-vercel-gray-400 mb-4">Component: src/components/Avatar.tsx</p>
          <div className="flex gap-4 items-end">
            <div className="text-center">
              <Avatar name="John Doe" size={24} />
              <p className="text-2xs text-vercel-gray-400 mt-2">24px</p>
            </div>
            <div className="text-center">
              <Avatar name="Jane Smith" size={32} />
              <p className="text-2xs text-vercel-gray-400 mt-2">32px</p>
            </div>
            <div className="text-center">
              <Avatar name="Bob Wilson" size={40} />
              <p className="text-2xs text-vercel-gray-400 mt-2">40px</p>
            </div>
          </div>
        </div>

        {/* Select */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-4">Select</h3>
          <p className="text-xs text-vercel-gray-400 mb-4">Component: src/components/Select.tsx</p>
          <div className="max-w-xs">
            <Select
              value="option1"
              onChange={() => {}}
              options={[
                { value: 'option1', label: 'Option 1' },
                { value: 'option2', label: 'Option 2' },
                { value: 'option3', label: 'Option 3' },
              ]}
            />
          </div>
        </div>

        {/* Modal */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-4">Modal</h3>
          <p className="text-xs text-vercel-gray-400 mb-4">Component: src/components/Modal.tsx</p>
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            Open Modal
          </Button>
          <Modal
            isOpen={modalOpen}
            onClose={() => setModalOpen(false)}
            title="Example Modal"
          >
            <p className="text-sm text-vercel-gray-400">This is the modal content.</p>
          </Modal>
        </div>

        {/* MetricCard */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-4">MetricCard</h3>
          <p className="text-xs text-vercel-gray-400 mb-4">Component: src/components/MetricCard.tsx</p>
          <div className="grid grid-cols-3 gap-4 max-w-xl">
            <MetricCard title="Total Hours" value="168.5" />
            <MetricCard title="Projects" value="12" />
            <MetricCard title="Revenue" value="$45,230" />
          </div>
        </div>

        {/* MetricCard-Alert */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-4">MetricCard-Alert</h3>
          <p className="text-xs text-vercel-gray-400 mb-4">Component: src/components/MetricCard.tsx (isAlert prop)</p>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <MetricCard title="Resources Under Target" value="0" />
            <MetricCard title="Resources Under Target" value="3" isAlert onClick={() => {}} actionLabel="View" />
          </div>
        </div>

        {/* AccordionNested (3 levels with left line) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-4">AccordionNested (Projects Pattern)</h3>
          <p className="text-xs text-vercel-gray-400 mb-4">Component: src/components/AccordionNested.tsx — 3 levels: Project → Resource → Task breakdown. Left border line indicates hierarchy.</p>
          <div className="max-w-xl">
            <AccordionNested
              header={
                <>
                  <h3 className="text-sm font-semibold text-vercel-gray-600">FoodCycleScience</h3>
                  <p className="text-xs font-mono text-vercel-gray-400">3 resources</p>
                </>
              }
              headerRight={
                <div className="text-right">
                  <div className="text-lg font-semibold text-vercel-gray-600">64.5h</div>
                  <div className="text-xs font-mono text-vercel-gray-400">total</div>
                </div>
              }
              items={sampleNestedItems}
              defaultExpanded
            />
          </div>
        </div>

        {/* AccordionFlat (2 levels, table content) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-4">AccordionFlat (Billing Rates Pattern)</h3>
          <p className="text-xs text-vercel-gray-400 mb-4">Component: src/components/AccordionFlat.tsx — 2 levels: Header → Table content with columns, rows, and optional footer.</p>
          <div className="max-w-2xl">
            <AccordionFlat
              header={
                <>
                  <h3 className="text-sm font-semibold text-vercel-gray-600">Billing Rates & Revenue</h3>
                  <p className="text-xs font-mono text-vercel-gray-400">Click to edit hourly rates per project</p>
                </>
              }
              headerRight={
                <div className="text-right">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-success" />
                    <span className="text-lg font-semibold text-vercel-gray-600">$6,188.75</span>
                  </div>
                  <div className="text-xs font-mono text-vercel-gray-400">total revenue</div>
                </div>
              }
              columns={sampleFlatColumns}
              rows={sampleFlatRows}
              footer={sampleFlatFooter}
              defaultExpanded
            />
          </div>
        </div>

        {/* DropdownMenu */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-4">DropdownMenu</h3>
          <p className="text-xs text-vercel-gray-400 mb-4">Component: src/components/DropdownMenu.tsx</p>
          <div className="relative inline-block">
            <DropdownMenu
              items={[
                { label: 'Edit', onClick: () => {} },
                { label: 'Duplicate', onClick: () => {} },
                { label: 'Delete', onClick: () => {}, variant: 'danger' },
              ]}
              trigger={
                <span className="px-4 py-2 bg-vercel-gray-600 text-white rounded-md text-sm font-medium">
                  Open Dropdown
                </span>
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Molecules Section
function MoleculesSection() {
  return (
    <div className="space-y-8">
      <div className="grid gap-6">
        <div className="p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-2">DateRangeFilter</h3>
          <p className="text-xs text-vercel-gray-400">
            Combines buttons, date inputs, and navigation arrows for date selection.
          </p>
          <p className="text-2xs text-vercel-gray-200 mt-2 font-mono">src/components/DateRangeFilter.tsx</p>
        </div>

        <div className="p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-2">SubNavbar</h3>
          <p className="text-xs text-vercel-gray-400">
            Navigation bar with NavItem atoms for route switching.
          </p>
          <p className="text-2xs text-vercel-gray-200 mt-2 font-mono">src/components/SubNavbar.tsx</p>
        </div>

        <div className="p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-2">MainHeader</h3>
          <p className="text-xs text-vercel-gray-400">
            Application header with logo, user avatar, and dropdown menu.
          </p>
          <p className="text-2xs text-vercel-gray-200 mt-2 font-mono">src/components/MainHeader.tsx</p>
        </div>

        <div className="p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-2">*Table Components</h3>
          <p className="text-xs text-vercel-gray-400">
            HolidayTable, UserTable, ResourceTable - Data tables with sorting, actions, and row rendering.
          </p>
          <p className="text-2xs text-vercel-gray-200 mt-2 font-mono">src/components/*Table.tsx</p>
        </div>

        <div className="p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-2">*EditorModal Components</h3>
          <p className="text-xs text-vercel-gray-400">
            HolidayEditorModal, UserEditorModal, EmployeeEditorModal, ProjectEditorModal - Form modals for CRUD operations.
          </p>
          <p className="text-2xs text-vercel-gray-200 mt-2 font-mono">src/components/*EditorModal.tsx</p>
        </div>
      </div>
    </div>
  );
}

// Global Patterns Section
function PatternsSection({ showBackground, setShowBackground }: { showBackground: boolean; setShowBackground: (show: boolean) => void }) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-vercel-gray-600 mb-6">Approved Global Patterns</h2>

        {/* Mesh Gradient Background */}
        <div className="p-6 border border-vercel-gray-100 rounded-lg">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-sm font-medium text-vercel-gray-600">MeshGradientBackground</h3>
              <p className="text-xs text-vercel-gray-400 mt-1">
                Full-screen animated background with organic mesh gradient.
              </p>
              <p className="text-2xs text-vercel-gray-200 mt-2 font-mono">
                src/design-system/patterns/MeshGradientBackground.tsx
              </p>
            </div>
            <Button
              variant={showBackground ? 'primary' : 'secondary'}
              onClick={() => setShowBackground(!showBackground)}
            >
              {showBackground ? 'Hide Preview' : 'Show Preview'}
            </Button>
          </div>

          <div className="bg-vercel-gray-50 rounded-lg p-4 mt-4">
            <p className="text-xs font-medium text-vercel-gray-600 mb-2">Properties:</p>
            <ul className="text-xs text-vercel-gray-400 space-y-1">
              <li><span className="font-mono text-brand-indigo">duration</span>: Animation duration in seconds (default: 20)</li>
              <li><span className="font-mono text-brand-indigo">blur</span>: Blur intensity in pixels (default: 80)</li>
              <li><span className="font-mono text-brand-indigo">opacity</span>: Opacity 0-1 (default: 0.6)</li>
            </ul>
          </div>

          <div className="bg-error-light rounded-lg p-4 mt-4">
            <p className="text-xs font-medium text-vercel-gray-600 mb-2">Usage Notes:</p>
            <ul className="text-xs text-vercel-gray-400 space-y-1">
              <li>Place as first child of layout container</li>
              <li>Content above should have position: relative and z-index</li>
              <li>Respects prefers-reduced-motion</li>
              <li>Do NOT override colors with raw hex values</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default StyleReviewPage;
