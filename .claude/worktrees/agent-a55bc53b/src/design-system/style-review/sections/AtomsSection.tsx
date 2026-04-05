/**
 * AtomsSection - Atom Component Previews
 *
 * Displays live previews for all 22 registered atoms.
 * 15 existing + 9 new previews. 10 components relocated to Molecules/Organisms.
 */

import { useState } from 'react';
import { Button } from '../../../components/Button';
import { Spinner } from '../../../components/Spinner';
import { Input } from '../../../components/Input';
import { Toggle } from '../../../components/Toggle';
import { Checkbox } from '../../../components/Checkbox';
import { Alert } from '../../../components/Alert';
import { Card } from '../../../components/Card';
import { Badge } from '../../../components/Badge';
import { Icon } from '../../../components/Icon';
import { TypingIndicator } from '../../../components/TypingIndicator';
import { Select } from '../../../components/Select';
import { Modal } from '../../../components/Modal';
import { Avatar } from '../../../components/Avatar';
import { MultiSelect } from '../../../components/MultiSelect';
import { Accordion } from '../../../components/Accordion';
import { ChevronIcon } from '../../../components/ChevronIcon';
import { NavItem } from '../../../components/NavItem';
import { Markdown } from '../../../components/Markdown';
import { BarChartAtom } from '../../../components/atoms/charts/BarChartAtom';
import { CAGRChartAtom } from '../../../components/atoms/charts/CAGRChartAtom';
import { DailyHoursChart } from '../../../components/atoms/charts/DailyHoursChart';
import {
  mockBarChartData,
  mockCAGRData,
  mockTimesheetEntries,
  mockResources,
  mockHolidays,
} from '../mockData';

export function AtomsSection() {
  const [modalOpen, setModalOpen] = useState(false);
  const [multiSelectValues, setMultiSelectValues] = useState<string[]>(['opt-1']);
  const [activeNav, setActiveNav] = useState('dashboard');

  // DailyHoursChart date range (7 days)
  const currentYear = new Date().getFullYear();
  const dailyChartStart = new Date(currentYear, 1, 10); // Feb 10
  const dailyChartEnd = new Date(currentYear, 1, 14); // Feb 14

  return (
    <div className="space-y-12">
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
            <Toggle label="Send Invite Email" description="User will receive an email to set their password" checked={true} onChange={() => {}} />
            <Toggle label="Toggle Off State" description="This toggle is currently off" checked={false} onChange={() => {}} />
            <Toggle label="Disabled Toggle" checked={true} onChange={() => {}} disabled />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Label with optional description, on/off states, disabled state.
            </p>
          </div>
        </div>

        {/* Checkbox */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">Checkbox</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/Checkbox.tsx</p>
          </div>
          <div className="grid gap-4 max-w-md">
            <div>
              <p className="text-xs text-vercel-gray-400 mb-2">Default States</p>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Checkbox checked={false} onChange={() => {}} label="Unchecked" />
                <Checkbox checked={true} onChange={() => {}} label="Checked" />
              </div>
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-2">Indeterminate</p>
              <Checkbox checked={false} indeterminate onChange={() => {}} label="Select All" />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-2">With Description</p>
              <Checkbox checked={true} onChange={() => {}} label="Include Tasks" description="Show task-level breakdown per project" />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-2">With End Content</p>
              <Checkbox checked={true} onChange={() => {}} label="Acme Corporation" endContent={<span className="text-sm text-vercel-gray-300 tabular-nums">$12,450.00</span>} />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-2">Disabled</p>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Checkbox checked={false} onChange={() => {}} label="Disabled Off" disabled />
                <Checkbox checked={true} onChange={() => {}} label="Disabled On" disabled />
              </div>
            </div>
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Props:</span> checked, onChange, label, description, indeterminate, disabled, endContent, className
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
            <Card variant="default"><p className="text-sm text-vercel-gray-600">Default Card</p></Card>
            <Card variant="elevated"><p className="text-sm text-vercel-gray-600">Elevated Card</p></Card>
            <Card variant="bordered"><p className="text-sm text-vercel-gray-600">Bordered Card</p></Card>
            <Card variant="subtle"><p className="text-sm text-vercel-gray-600">Subtle Card</p></Card>
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
                <div className="text-center"><Icon type="chat" size="sm" /><p className="text-[10px] text-vercel-gray-400 mt-1">Small</p></div>
                <div className="text-center"><Icon type="chat" size="md" /><p className="text-[10px] text-vercel-gray-400 mt-1">Medium</p></div>
                <div className="text-center"><Icon type="chat" size="lg" /><p className="text-[10px] text-vercel-gray-400 mt-1">Large</p></div>
              </div>
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-2">Variants</p>
              <div className="flex gap-4 items-center">
                <div className="text-center"><Icon type="chat" variant="default" /><p className="text-[10px] text-vercel-gray-400 mt-1">Default</p></div>
                <div className="text-center"><Icon type="chat" variant="primary" /><p className="text-[10px] text-vercel-gray-400 mt-1">Primary</p></div>
                <div className="text-center"><Icon type="chat" variant="brand" /><p className="text-[10px] text-vercel-gray-400 mt-1">Brand</p></div>
              </div>
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-2">Preset Icon Types</p>
              <div className="flex gap-4 items-center">
                <div className="text-center"><Icon type="chat" /><p className="text-[10px] text-vercel-gray-400 mt-1">Chat</p></div>
                <div className="text-center"><Icon type="user" /><p className="text-[10px] text-vercel-gray-400 mt-1">User</p></div>
                <div className="text-center"><Icon type="settings" /><p className="text-[10px] text-vercel-gray-400 mt-1">Settings</p></div>
                <div className="text-center"><Icon type="search" /><p className="text-[10px] text-vercel-gray-400 mt-1">Search</p></div>
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

        {/* Avatar */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-4">Avatar</h3>
          <p className="text-xs text-vercel-gray-400 mb-4">Component: src/components/Avatar.tsx</p>
          <div className="flex gap-4 items-end">
            <div className="text-center"><Avatar name="John Doe" size={24} /><p className="text-2xs text-vercel-gray-400 mt-2">24px</p></div>
            <div className="text-center"><Avatar name="Jane Smith" size={32} /><p className="text-2xs text-vercel-gray-400 mt-2">32px</p></div>
            <div className="text-center"><Avatar name="Bob Wilson" size={40} /><p className="text-2xs text-vercel-gray-400 mt-2">40px</p></div>
            <div className="text-center"><Avatar name="With Image" size={40} src="https://api.dicebear.com/7.x/avataaars/svg?seed=demo" /><p className="text-2xs text-vercel-gray-400 mt-2">with image</p></div>
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Gradient initials fallback, optional image src with error handling, customizable size.
            </p>
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
          <Button variant="primary" onClick={() => setModalOpen(true)}>Open Modal</Button>
          <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Example Modal">
            <p className="text-sm text-vercel-gray-400">This is the modal content.</p>
          </Modal>
        </div>

        {/* MultiSelect (NEW) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">MultiSelect</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/MultiSelect.tsx</p>
          </div>
          <div className="max-w-xs">
            <MultiSelect
              values={multiSelectValues}
              onChange={setMultiSelectValues}
              options={[
                { value: 'opt-1', label: 'FoodCycleScience' },
                { value: 'opt-2', label: 'Neocurrency' },
                { value: 'opt-3', label: 'The B Team' },
                { value: 'opt-4', label: 'CloudVault' },
                { value: 'opt-5', label: 'DataPipeline' },
              ]}
              placeholder="Select projects..."
            />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Props:</span> values, onChange, options, placeholder, disabled, className
            </p>
          </div>
        </div>

        {/* Accordion (NEW) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">Accordion</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/Accordion.tsx</p>
          </div>
          <div className="space-y-4 max-w-xl">
            <Accordion
              header={<span className="text-sm font-medium text-vercel-gray-600">Expanded by default</span>}
              headerRight={<span className="text-xs text-vercel-gray-400">3 items</span>}
              defaultExpanded
            >
              <div className="p-4 text-sm text-vercel-gray-400">
                Accordion content is visible when expanded. Click the header to collapse.
              </div>
            </Accordion>
            <Accordion
              header={<span className="text-sm font-medium text-vercel-gray-600">Collapsed by default</span>}
              headerRight={<span className="text-xs text-vercel-gray-400">5 items</span>}
            >
              <div className="p-4 text-sm text-vercel-gray-400">
                This content was hidden until you clicked the header.
              </div>
            </Accordion>
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Props:</span> header, headerRight, children, defaultExpanded, className
            </p>
          </div>
        </div>

        {/* ChevronIcon (NEW) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">ChevronIcon</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/ChevronIcon.tsx</p>
          </div>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-vercel-gray-400 mb-2">Directions</p>
              <div className="flex gap-6 items-center">
                <div className="text-center"><ChevronIcon direction="left" /><p className="text-[10px] text-vercel-gray-400 mt-1">Left</p></div>
                <div className="text-center"><ChevronIcon direction="right" /><p className="text-[10px] text-vercel-gray-400 mt-1">Right</p></div>
                <div className="text-center"><ChevronIcon direction="up" /><p className="text-[10px] text-vercel-gray-400 mt-1">Up</p></div>
                <div className="text-center"><ChevronIcon direction="down" /><p className="text-[10px] text-vercel-gray-400 mt-1">Down</p></div>
              </div>
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-2">Sizes</p>
              <div className="flex gap-6 items-center">
                <div className="text-center"><ChevronIcon size="xs" /><p className="text-[10px] text-vercel-gray-400 mt-1">XS</p></div>
                <div className="text-center"><ChevronIcon size="sm" /><p className="text-[10px] text-vercel-gray-400 mt-1">SM</p></div>
                <div className="text-center"><ChevronIcon size="md" /><p className="text-[10px] text-vercel-gray-400 mt-1">MD</p></div>
                <div className="text-center"><ChevronIcon size="lg" /><p className="text-[10px] text-vercel-gray-400 mt-1">LG</p></div>
              </div>
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-2">Expanded state (rotated 90deg clockwise)</p>
              <div className="flex gap-6 items-center">
                <div className="text-center"><ChevronIcon direction="right" expanded /><p className="text-[10px] text-vercel-gray-400 mt-1">Right expanded</p></div>
                <div className="text-center"><ChevronIcon direction="down" expanded /><p className="text-[10px] text-vercel-gray-400 mt-1">Down expanded</p></div>
              </div>
            </div>
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Props:</span> direction (left|right|up|down), expanded, size (xs|sm|md|lg), className
            </p>
          </div>
        </div>

        {/* NavItem (NEW) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">NavItem</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/NavItem.tsx</p>
          </div>
          <div className="flex gap-1 border-b border-vercel-gray-100 pb-px">
            <NavItem label="Dashboard" isActive={activeNav === 'dashboard'} onClick={() => setActiveNav('dashboard')} />
            <NavItem label="Employees" isActive={activeNav === 'employees'} onClick={() => setActiveNav('employees')} />
            <NavItem label="Settings" isActive={activeNav === 'settings'} onClick={() => setActiveNav('settings')} />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Active indicator bar (2px black bottom border), hover transition, rounded-md hover bg.
            </p>
          </div>
        </div>

        {/* Markdown (NEW) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">Markdown</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/Markdown.tsx</p>
          </div>
          <div className="max-w-lg bg-vercel-gray-50 rounded-lg p-4">
            <Markdown content={`**Bold text** and *italic text* together.

Here's a list:
- First item with **bold**
- Second item with *emphasis*
- Third item

1. Numbered item one
2. Numbered item two

Inline \`code\` in a sentence.`} />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Renders **bold**, *italic*, - lists, numbered lists, `code`, and line breaks. Lightweight parser for chat messages and legal documents.
            </p>
          </div>
        </div>

        {/* AIChatButton (INFO CARD - opens AIChatWindow with API hook) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="text-sm font-medium text-vercel-gray-600">AIChatButton</h3>
              <p className="text-xs text-vercel-gray-400">Floating action button that toggles the AI chat window.</p>
            </div>
            <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">atom</span>
          </div>
          <p className="text-2xs text-vercel-gray-200 font-mono mb-3">src/components/chat/AIChatButton.tsx</p>
          <div className="p-3 bg-warning-light border border-warning-medium rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium text-vercel-gray-600">Requires live data:</span> AIChatButton opens AIChatWindow which connects to the AI chat API on mount. Visit the main app to see it in action.
            </p>
          </div>
        </div>

        {/* BarChartAtom (NEW) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">BarChartAtom</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/atoms/charts/BarChartAtom.tsx</p>
          </div>
          <div>
            <BarChartAtom data={mockBarChartData} />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Monthly bar chart with positive (green) and negative (red) bars. Null values render as gray. Used for MoM growth rate visualization.
            </p>
          </div>
        </div>

        {/* CAGRChartAtom (NEW) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">CAGRChartAtom</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/atoms/charts/CAGRChartAtom.tsx</p>
          </div>
          <div>
            <CAGRChartAtom data={mockCAGRData} />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> CAGR projection line chart showing actual (bteam-brand) and projected (vercel-gray) revenue by year. Font-mono for axes and tooltips.
            </p>
          </div>
        </div>

        {/* DailyHoursChart (NEW) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">DailyHoursChart</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/atoms/charts/DailyHoursChart.tsx</p>
          </div>
          <div>
            <DailyHoursChart
              entries={mockTimesheetEntries}
              startDate={dailyChartStart}
              endDate={dailyChartEnd}
              holidays={mockHolidays}
              resources={mockResources}
            />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Stacked bar chart showing daily hours by employee. Horizontal expected-hours line based on employment type. Accounts for holidays and time-off.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
