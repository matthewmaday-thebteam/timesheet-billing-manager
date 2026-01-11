/**
 * Style Review Surface - Dev-only Component
 *
 * This page displays all official components and proposed variants side-by-side
 * for visual comparison. Only accessible in development mode.
 *
 * @dev-only This route is excluded from production builds
 */

import { useState } from 'react';
import { MeshGradientBackground } from '../patterns/MeshGradientBackground';
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

type Section = 'tokens' | 'atoms' | 'molecules' | 'patterns';

export function StyleReviewPage({ onClose }: { onClose: () => void }) {
  const [activeSection, setActiveSection] = useState<Section>('tokens');
  const [showBackground, setShowBackground] = useState(false);

  const sections: { id: Section; label: string }[] = [
    { id: 'tokens', label: 'Design Tokens' },
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
                Style Review Surface
              </h1>
              <p className="text-sm text-vercel-gray-400">
                Dev-only visual comparison of design system components
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

  return (
    <div className="space-y-12">
      {/* Note about promoted atoms */}
      <div className="bg-success-light border border-success-border rounded-lg p-4">
        <p className="text-sm text-success-text font-medium">All High-Impact Components Promoted (Tasks 014-015)</p>
        <p className="text-sm text-success-text mt-1">
          Button, Spinner (Task 014) and Input, Card, Badge (Task 015) are now official design system atoms.
        </p>
      </div>

      {/* Official Atoms */}
      <div>
        <h2 className="text-lg font-semibold text-vercel-gray-600 mb-6">Official Atoms</h2>

        {/* Button - PROMOTED */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-medium text-vercel-gray-600">Button</h3>
              <p className="text-xs text-vercel-gray-400">Component: src/components/Button.tsx</p>
            </div>
            <span className="px-2 py-1 bg-success-light text-success-text text-[10px] font-medium rounded">
              PROMOTED
            </span>
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

        {/* Spinner - PROMOTED */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-medium text-vercel-gray-600">Spinner</h3>
              <p className="text-xs text-vercel-gray-400">Component: src/components/Spinner.tsx</p>
            </div>
            <span className="px-2 py-1 bg-success-light text-success-text text-[10px] font-medium rounded">
              PROMOTED
            </span>
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

        {/* Input - PROMOTED (Task 015) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-medium text-vercel-gray-600">Input</h3>
              <p className="text-xs text-vercel-gray-400">Component: src/components/Input.tsx</p>
            </div>
            <span className="px-2 py-1 bg-success-light text-success-text text-[10px] font-medium rounded">
              PROMOTED
            </span>
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

        {/* Card - PROMOTED (Task 015) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-medium text-vercel-gray-600">Card</h3>
              <p className="text-xs text-vercel-gray-400">Component: src/components/Card.tsx</p>
            </div>
            <span className="px-2 py-1 bg-success-light text-success-text text-[10px] font-medium rounded">
              PROMOTED
            </span>
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

        {/* Badge - PROMOTED (Task 015) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-medium text-vercel-gray-600">Badge</h3>
              <p className="text-xs text-vercel-gray-400">Component: src/components/Badge.tsx</p>
            </div>
            <span className="px-2 py-1 bg-success-light text-success-text text-[10px] font-medium rounded">
              PROMOTED
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="default">Default</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="error">Error</Badge>
            <Badge variant="info">Info</Badge>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <Badge variant="default" size="sm">Small Default</Badge>
            <Badge variant="success" size="sm">Small Success</Badge>
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
      <div className="bg-success-light border border-success-border rounded-lg p-4">
        <p className="text-sm text-success-text">
          Molecules are combinations of atoms. See individual page components for examples of forms,
          tables, and composite UI elements.
        </p>
      </div>

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
