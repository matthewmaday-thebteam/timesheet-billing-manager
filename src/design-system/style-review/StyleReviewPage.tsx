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
import { AvatarUpload } from '../../components/AvatarUpload';
import { MetricCard } from '../../components/MetricCard';
import { DropdownMenu } from '../../components/DropdownMenu';
import { Button } from '../../components/Button';
import { Spinner } from '../../components/Spinner';
import { Input } from '../../components/Input';
import { Toggle } from '../../components/Toggle';
import { Alert } from '../../components/Alert';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Icon } from '../../components/Icon';
import { TypingIndicator } from '../../components/TypingIndicator';
import { DatePicker } from '../../components/DatePicker';
import { HolidayCalendar } from '../../components/HolidayCalendar';
import { AccordionNested } from '../../components/AccordionNested';
import type { AccordionNestedLevel2Item } from '../../components/AccordionNested';
import { AccordionFlat } from '../../components/AccordionFlat';
import type { AccordionFlatColumn, AccordionFlatRow, AccordionFlatFooterCell } from '../../components/AccordionFlat';
import { AccordionListTable } from '../../components/AccordionListTable';
import type { AccordionListTableColumn, AccordionListTableItem } from '../../components/AccordionListTable';
import { PieChartAtom } from '../../components/atoms/charts/PieChartAtom';
import { LineGraphAtom } from '../../components/atoms/charts/LineGraphAtom';
import { RangeSelector } from '../../components/molecules/RangeSelector';
import { DateCycle } from '../../components/molecules/DateCycle';
import { generateMockPieData, generateMockLineData } from '../../utils/chartTransforms';
import type { DateRange } from '../../types';

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
    <div className={`min-h-screen ${showBackground ? 'bg-transparent' : 'bg-white'}`}>
      {/* Background preview overlay - rendered first so it's behind content */}
      {showBackground && <MeshGradientBackground />}

      {/* Header */}
      <div className={`sticky top-0 z-50 border-b border-vercel-gray-100 ${showBackground ? 'bg-white/90 backdrop-blur-sm' : 'bg-white'}`}>
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
          <div className="flex gap-1 mt-4">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`relative px-3 py-2 text-sm font-medium rounded-md transition-all duration-200 ease-out hover:bg-vercel-gray-100 focus:outline-none ${
                  activeSection === section.id
                    ? 'text-vercel-gray-600'
                    : 'text-vercel-gray-400 hover:text-vercel-gray-600'
                }`}
              >
                {section.label}
                {/* Active indicator - sits on the header border */}
                <span
                  className={`absolute left-0 right-0 -bottom-[17px] h-[2px] bg-vercel-gray-600 transition-all duration-200 ease-out ${
                    activeSection === section.id ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'
                  }`}
                  style={{ borderRadius: '1px 1px 0 0' }}
                />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className={`max-w-7xl mx-auto px-6 py-8 ${showBackground ? 'relative z-10' : ''}`}>
        {activeSection === 'tokens' && <TokensSection />}
        {activeSection === 'typography' && <TypographyPreview showAll />}
        {activeSection === 'atoms' && <AtomsSection />}
        {activeSection === 'molecules' && <MoleculesSection />}
        {activeSection === 'patterns' && (
          <PatternsSection showBackground={showBackground} setShowBackground={setShowBackground} />
        )}
      </div>
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
      { name: 'Success Medium', value: '#C5F0E2', token: '--color-success-medium' },
      { name: 'Success Light', value: '#F0FDF4', token: '--color-success-light' },
    ],
    'Semantic - Warning': [
      { name: 'Warning', value: '#F5A623', token: '--color-warning' },
      { name: 'Warning Medium', value: '#F1D4A3', token: '--color-warning-medium' },
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

  // Sample data for AccordionListTable demo
  const sampleListTableColumns: AccordionListTableColumn[] = [
    { key: 'client', label: 'Client', align: 'left' },
    { key: 'date', label: 'Date', align: 'left' },
    { key: 'task', label: 'Task', align: 'left' },
    { key: 'time', label: 'Time', align: 'right' },
  ];

  const sampleListTableItems: AccordionListTableItem[] = [
    {
      id: 'john',
      statusColor: 'error',
      headerLeft: <span className="text-sm font-medium text-vercel-gray-600">John Smith</span>,
      headerRight: (
        <div className="text-right">
          <span className="text-sm font-medium text-vercel-gray-600">32.5h</span>
          <span className="text-sm text-vercel-gray-400 mx-1">/</span>
          <span className="text-sm font-mono text-vercel-gray-400">70.0h</span>
          <span className="text-sm font-mono text-bteam-brand ml-3">-37.5h</span>
        </div>
      ),
      rows: [
        {
          id: 'john-1',
          cells: {
            client: <span className="text-vercel-gray-600 font-medium">Acme Corp</span>,
            date: <span className="text-vercel-gray-400 font-mono">Jan 9</span>,
            task: <span className="text-vercel-gray-400 font-mono">Development</span>,
            time: <span className="text-vercel-gray-600 font-medium">8.0h</span>,
          },
        },
        {
          id: 'john-2',
          cells: {
            client: <span className="text-vercel-gray-600 font-medium">Acme Corp</span>,
            date: <span className="text-vercel-gray-400 font-mono">Jan 8</span>,
            task: <span className="text-vercel-gray-400 font-mono">Code review</span>,
            time: <span className="text-vercel-gray-600 font-medium">4.5h</span>,
          },
        },
      ],
      emptyMessage: 'No tasks recorded',
    },
    {
      id: 'jane',
      statusColor: 'warning',
      headerLeft: <span className="text-sm font-medium text-vercel-gray-600">Jane Doe</span>,
      headerRight: (
        <div className="text-right">
          <span className="text-sm font-medium text-vercel-gray-600">58.0h</span>
          <span className="text-sm text-vercel-gray-400 mx-1">/</span>
          <span className="text-sm font-mono text-vercel-gray-400">70.0h</span>
          <span className="text-sm font-mono text-bteam-brand ml-3">-12.0h</span>
        </div>
      ),
      rows: [
        {
          id: 'jane-1',
          cells: {
            client: <span className="text-vercel-gray-600 font-medium">TechStart</span>,
            date: <span className="text-vercel-gray-400 font-mono">Jan 9</span>,
            task: <span className="text-vercel-gray-400 font-mono">Design work</span>,
            time: <span className="text-vercel-gray-600 font-medium">7.5h</span>,
          },
        },
      ],
      emptyMessage: 'No tasks recorded',
    },
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
          <div className="space-y-4">
            <div>
              <p className="text-xs text-vercel-gray-400 mb-2">Variants</p>
              <div className="flex flex-wrap gap-3">
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger">Danger</Button>
              </div>
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-2">Sizes</p>
              <div className="flex flex-wrap gap-3 items-center">
                <Button variant="primary" size="sm">Small</Button>
                <Button variant="primary" size="md">Medium</Button>
                <Button variant="primary" size="lg">Large</Button>
                <Button variant="primary" disabled>Disabled</Button>
              </div>
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-2">Icon-Only Buttons</p>
              <div className="flex flex-wrap gap-3 items-center">
                <Button variant="primary" size="sm" iconOnly aria-label="Send">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </Button>
                <Button variant="primary" size="md" iconOnly aria-label="Send">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </Button>
                <Button variant="primary" size="lg" iconOnly aria-label="Send">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </Button>
                <Button variant="ghost" size="md" iconOnly aria-label="Delete">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </Button>
                <Button variant="danger" size="md" iconOnly aria-label="Delete">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </Button>
                <Button variant="secondary" size="md" iconOnly aria-label="Settings">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </Button>
              </div>
            </div>
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Props:</span> variant (primary|secondary|ghost|danger), size (sm|md|lg), iconOnly (boolean for square icon buttons)
            </p>
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

        {/* Toggle */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">Toggle</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/Toggle.tsx</p>
          </div>
          <div className="grid gap-4 max-w-md">
            <Toggle
              label="Send Invite Email"
              description="User will receive an email to set their password"
              checked={true}
              onChange={() => {}}
            />
            <Toggle
              label="Toggle Off State"
              description="This toggle is currently off"
              checked={false}
              onChange={() => {}}
            />
            <Toggle
              label="Disabled Toggle"
              checked={true}
              onChange={() => {}}
              disabled
            />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Label with optional description, on/off states, disabled state.
            </p>
          </div>
        </div>

        {/* Alert */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">Alert</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/Alert.tsx</p>
          </div>
          <div className="grid gap-4 max-w-md">
            <Alert message="Invalid login credentials" icon="error" />
            <Alert message="Please check your input and try again" icon="info" />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Subtle gray styling (vercel-gray-50 bg, vercel-gray-200 border/icon/text). Error and info icon variants.
            </p>
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

        {/* Icon */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">Icon</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/Icon.tsx</p>
          </div>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-vercel-gray-400 mb-2">Sizes</p>
              <div className="flex gap-4 items-center">
                <div className="text-center">
                  <Icon type="chat" size="sm" />
                  <p className="text-[10px] text-vercel-gray-400 mt-1">Small</p>
                </div>
                <div className="text-center">
                  <Icon type="chat" size="md" />
                  <p className="text-[10px] text-vercel-gray-400 mt-1">Medium</p>
                </div>
                <div className="text-center">
                  <Icon type="chat" size="lg" />
                  <p className="text-[10px] text-vercel-gray-400 mt-1">Large</p>
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-2">Variants</p>
              <div className="flex gap-4 items-center">
                <div className="text-center">
                  <Icon type="chat" variant="default" />
                  <p className="text-[10px] text-vercel-gray-400 mt-1">Default</p>
                </div>
                <div className="text-center">
                  <Icon type="chat" variant="primary" />
                  <p className="text-[10px] text-vercel-gray-400 mt-1">Primary</p>
                </div>
                <div className="text-center">
                  <Icon type="chat" variant="brand" />
                  <p className="text-[10px] text-vercel-gray-400 mt-1">Brand</p>
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-2">Preset Icon Types</p>
              <div className="flex gap-4 items-center">
                <div className="text-center">
                  <Icon type="chat" />
                  <p className="text-[10px] text-vercel-gray-400 mt-1">Chat</p>
                </div>
                <div className="text-center">
                  <Icon type="user" />
                  <p className="text-[10px] text-vercel-gray-400 mt-1">User</p>
                </div>
                <div className="text-center">
                  <Icon type="settings" />
                  <p className="text-[10px] text-vercel-gray-400 mt-1">Settings</p>
                </div>
                <div className="text-center">
                  <Icon type="search" />
                  <p className="text-[10px] text-vercel-gray-400 mt-1">Search</p>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Circular container for icons. Supports preset types (chat, user, settings, search) or custom SVG children. Three sizes (sm, md, lg) and three variants (default, primary, brand).
            </p>
          </div>
        </div>

        {/* TypingIndicator */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">TypingIndicator</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/TypingIndicator.tsx</p>
          </div>
          <div className="flex items-center gap-4">
            <TypingIndicator />
            <span className="text-sm text-vercel-gray-400">AI is thinking...</span>
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Messenger-style 3-dot animation using bteam-brand color. Wave pattern with staggered delays. Scale-up entrance animation from bottom-left.
            </p>
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
            <div className="text-center">
              <Avatar name="With Image" size={40} src="https://api.dicebear.com/7.x/avataaars/svg?seed=demo" />
              <p className="text-2xs text-vercel-gray-400 mt-2">with image</p>
            </div>
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Gradient initials fallback, optional image src with error handling, customizable size.
            </p>
          </div>
        </div>

        {/* AvatarUpload */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-4">AvatarUpload</h3>
          <p className="text-xs text-vercel-gray-400 mb-4">Component: src/components/AvatarUpload.tsx</p>
          <div className="flex gap-8 items-start">
            <div>
              <AvatarUpload
                name="Demo User"
                onImageCropped={() => {}}
                size={96}
              />
            </div>
            <div className="flex-1">
              <div className="p-3 bg-vercel-gray-50 rounded-lg">
                <p className="text-xs text-vercel-gray-400">
                  <span className="font-medium">Features:</span> Click to upload, file validation (image types, max 10MB),
                  circular crop modal with zoom control, outputs 256x256 JPEG blob.
                </p>
              </div>
              <div className="mt-3 p-3 bg-vercel-gray-50 rounded-lg">
                <p className="text-xs text-vercel-gray-400">
                  <span className="font-medium">Dependencies:</span> react-easy-crop for cropping UI.
                </p>
              </div>
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

        {/* AccordionListTable (Multiple expandable items with tables) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-4">AccordionListTable (Resources Under Target Pattern)</h3>
          <p className="text-xs text-vercel-gray-400 mb-4">Component: src/components/AccordionListTable.tsx — Multiple expandable items, each with table content. Optional status indicator dot.</p>
          <div className="max-w-2xl">
            <AccordionListTable
              columns={sampleListTableColumns}
              items={sampleListTableItems}
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

        {/* PieChartAtom */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">PieChartAtom</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/atoms/charts/PieChartAtom.tsx</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">Default (donut style)</p>
              <PieChartAtom data={generateMockPieData()} />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">Pie style (innerRadius=0)</p>
              <PieChartAtom data={generateMockPieData()} innerRadius={0} outerRadius={80} />
            </div>
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Donut/pie chart with auto-grouping of segments beyond maxSegments into "Other". Uses font-mono for all text. Colors from design tokens.
            </p>
          </div>
        </div>

        {/* LineGraphAtom */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">LineGraphAtom</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/atoms/charts/LineGraphAtom.tsx</p>
          </div>
          <div>
            <LineGraphAtom data={generateMockLineData()} />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> 12-month time series with Target (solid indigo), Budget (dashed purple), and Revenue (solid green) lines. Font-mono for axes, legend, tooltip. Currency formatting on Y-axis.
            </p>
          </div>
          <div className="mt-2 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs font-medium text-vercel-gray-600 mb-2">Line Colors:</p>
            <ul className="text-xs text-vercel-gray-400 space-y-1">
              <li><span className="inline-block w-3 h-3 rounded bg-brand-indigo mr-2"></span>Target (1.8x) - brand-indigo (solid)</li>
              <li><span className="inline-block w-3 h-3 rounded bg-brand-purple mr-2"></span>Budget - brand-purple (dashed)</li>
              <li><span className="inline-block w-3 h-3 rounded bg-success mr-2"></span>Revenue - success (solid)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// Molecules Section
function MoleculesSection() {
  const [dateCycleDate, setDateCycleDate] = useState(new Date());
  const [rangeSelectorValue, setRangeSelectorValue] = useState<DateRange>(() => {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
    };
  });

  return (
    <div className="space-y-12">
      {/* Official Molecules */}
      <div>
        <h2 className="text-lg font-semibold text-vercel-gray-600 mb-6">Official Molecules</h2>

        {/* DateCycle */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">DateCycle</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/molecules/DateCycle.tsx</p>
          </div>
          <div className="space-y-6">
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">Default (size="md", variant="default")</p>
              <DateCycle
                selectedDate={dateCycleDate}
                onDateChange={setDateCycleDate}
              />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">Small (size="sm")</p>
              <DateCycle
                selectedDate={dateCycleDate}
                onDateChange={setDateCycleDate}
                size="sm"
              />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">Large (size="lg") - 50% larger than md</p>
              <DateCycle
                selectedDate={dateCycleDate}
                onDateChange={setDateCycleDate}
                size="lg"
              />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">Boxed variant (variant="boxed", size="md")</p>
              <DateCycle
                selectedDate={dateCycleDate}
                onDateChange={setDateCycleDate}
                variant="boxed"
              />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">Boxed Large (variant="boxed", size="lg")</p>
              <DateCycle
                selectedDate={dateCycleDate}
                onDateChange={setDateCycleDate}
                variant="boxed"
                size="lg"
              />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">Custom format ("MMM yyyy")</p>
              <DateCycle
                selectedDate={dateCycleDate}
                onDateChange={setDateCycleDate}
                formatString="MMM yyyy"
              />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">Disabled</p>
              <DateCycle
                selectedDate={dateCycleDate}
                onDateChange={setDateCycleDate}
                disabled
              />
            </div>
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Month navigation with left/right arrows and centered date display. Three sizes (sm, md, lg), two variants (default, boxed), customizable date format via date-fns format string.
            </p>
          </div>
          <div className="mt-2 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs font-medium text-vercel-gray-600 mb-2">Props:</p>
            <ul className="text-xs text-vercel-gray-400 space-y-1">
              <li><span className="font-mono text-brand-indigo">selectedDate</span>: Currently selected date</li>
              <li><span className="font-mono text-brand-indigo">onDateChange</span>: Callback when date changes</li>
              <li><span className="font-mono text-brand-indigo">formatString</span>: date-fns format string (default: 'MMMM yyyy')</li>
              <li><span className="font-mono text-brand-indigo">size</span>: 'sm' | 'md' | 'lg' (default: 'md')</li>
              <li><span className="font-mono text-brand-indigo">variant</span>: 'default' | 'boxed' (default: 'default')</li>
              <li><span className="font-mono text-brand-indigo">disabled</span>: Disable navigation</li>
            </ul>
          </div>
        </div>

        {/* RangeSelector */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">RangeSelector</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/molecules/RangeSelector.tsx</p>
          </div>
          <div className="space-y-6">
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">variant="dateRange" - Month selection + date range text</p>
              <RangeSelector
                variant="dateRange"
                dateRange={rangeSelectorValue}
                onChange={setRangeSelectorValue}
              />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">variant="export" - Month selection + Export CSV button</p>
              <RangeSelector
                variant="export"
                dateRange={rangeSelectorValue}
                onChange={setRangeSelectorValue}
                onExport={() => alert('Export clicked!')}
              />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">variant="exportOnly" - Just the Export CSV button</p>
              <RangeSelector
                variant="exportOnly"
                onExport={() => alert('Export clicked!')}
              />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">variant="billings" - Month selection + Export CSV + Add Billing buttons</p>
              <RangeSelector
                variant="billings"
                dateRange={rangeSelectorValue}
                onChange={setRangeSelectorValue}
                onExport={() => alert('Export clicked!')}
                onAddBilling={() => alert('Add Billing clicked!')}
              />
            </div>
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Four variants - dateRange (month selection + date text), export (month selection + CSV button), exportOnly (just CSV button), billings (month selection + CSV + Add Billing). Integrates DateCycle molecule for month navigation.
            </p>
          </div>
          <div className="mt-2 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs font-medium text-vercel-gray-600 mb-2">Props:</p>
            <ul className="text-xs text-vercel-gray-400 space-y-1">
              <li><span className="font-mono text-brand-indigo">variant</span>: 'dateRange' | 'export' | 'exportOnly' | 'billings'</li>
              <li><span className="font-mono text-brand-indigo">dateRange</span>: Current date range (not needed for exportOnly)</li>
              <li><span className="font-mono text-brand-indigo">onChange</span>: Callback when date range changes (not needed for exportOnly)</li>
              <li><span className="font-mono text-brand-indigo">onExport</span>: Callback for Export CSV click</li>
              <li><span className="font-mono text-brand-indigo">exportDisabled</span>: Disable the export button</li>
              <li><span className="font-mono text-brand-indigo">onAddBilling</span>: Callback for Add Billing click (billings variant only)</li>
              <li><span className="font-mono text-brand-indigo">labels</span>: Custom labels for mode buttons</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Other Molecule Components */}
      <div>
        <h2 className="text-lg font-semibold text-vercel-gray-600 mb-6">Other Molecule Components</h2>
        <div className="grid gap-6">
          <div className="p-6 border border-vercel-gray-100 rounded-lg">
            <h3 className="text-sm font-medium text-vercel-gray-600 mb-2">MainHeader</h3>
            <p className="text-xs text-vercel-gray-400">
              Unified navigation header with NavItem atoms, Docs dropdown, user avatar, and profile menu.
            </p>
            <p className="text-2xs text-vercel-gray-200 mt-2 font-mono">src/components/MainHeader.tsx</p>
          </div>

          <div className="p-6 border border-vercel-gray-100 rounded-lg">
            <h3 className="text-sm font-medium text-vercel-gray-600 mb-2">DashboardChartsRow</h3>
            <p className="text-xs text-vercel-gray-400">
              Two-column responsive grid with PieChartAtom (hours by resource) and LineGraphAtom (12-month revenue trend).
            </p>
            <p className="text-2xs text-vercel-gray-200 mt-2 font-mono">src/components/DashboardChartsRow.tsx</p>
            <div className="mt-3 p-3 bg-vercel-gray-50 rounded-lg">
              <p className="text-xs text-vercel-gray-400">
                <span className="font-medium">Layout:</span> grid-cols-1 md:grid-cols-2 gap-4. Uses Card component with padding="lg".
              </p>
            </div>
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

          <div className="p-6 border border-vercel-gray-100 rounded-lg">
            <h3 className="text-sm font-medium text-vercel-gray-600 mb-2">ProfileEditorModal</h3>
            <p className="text-xs text-vercel-gray-400">
              User profile editor with avatar upload/crop, name fields, and email change with confirmation flow.
            </p>
            <p className="text-2xs text-vercel-gray-200 mt-2 font-mono">src/components/ProfileEditorModal.tsx</p>
            <div className="mt-3 p-3 bg-vercel-gray-50 rounded-lg">
              <p className="text-xs text-vercel-gray-400">
                <span className="font-medium">Combines:</span> Modal, AvatarUpload, Input, Button, Spinner. Integrates with AuthContext for profile updates.
              </p>
            </div>
          </div>
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
