/**
 * MoleculesSection - Molecule Component Previews
 *
 * Displays live previews for all 20 registered molecules.
 * 2 existing (DateCycle, RangeSelector) + 7 relocated from atoms + 11 new.
 */

import { useState } from 'react';
import { DateCycle } from '../../../components/molecules/DateCycle';
import { RangeSelector } from '../../../components/RangeSelector';
import { MetricCard } from '../../../components/MetricCard';
import { DatePicker } from '../../../components/DatePicker';
import { AvatarUpload } from '../../../components/AvatarUpload';
import { AccordionFlat } from '../../../components/AccordionFlat';
import type { AccordionFlatColumn, AccordionFlatRow, AccordionFlatFooterCell } from '../../../components/AccordionFlat';
import { DropdownMenu } from '../../../components/DropdownMenu';
import { PieChartAtom } from '../../../components/atoms/charts/PieChartAtom';
import { LineGraphAtom } from '../../../components/atoms/charts/LineGraphAtom';
import { generateMockPieData, generateMockLineData } from '../../../utils/chartTransforms';
import { DateRangeFilter } from '../../../components/DateRangeFilter';
import { MonthPicker } from '../../../components/MonthPicker';
import { ResourceRow } from '../../../components/ResourceRow';
import { ProjectCard } from '../../../components/ProjectCard';
import { TaskList as TaskListComponent } from '../../../components/TaskList';
import { ChatMessage } from '../../../components/chat/ChatMessage';
import { ChatInput } from '../../../components/chat/ChatInput';
import type { DateRange, MonthSelection } from '../../../types';
import type { ChatMessage as ChatMessageType } from '../../../types/chat';
import { molecules } from '../../registry/molecules';
import {
  mockTaskSummaries,
  mockResourceSummary,
  mockProjectSummary,
} from '../mockData';

export function MoleculesSection() {
  const [dateCycleDate, setDateCycleDate] = useState(new Date());
  const [rangeSelectorValue, setRangeSelectorValue] = useState<DateRange>(() => {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
    };
  });
  const [datePickerValue, setDatePickerValue] = useState('');
  const [dateRangeFilterValue, setDateRangeFilterValue] = useState<DateRange>(() => {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
    };
  });
  const [monthPickerValue, setMonthPickerValue] = useState<MonthSelection>({
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
  });

  // Sample data for AccordionFlat demo (relocated from atoms)
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

  // Sample chat messages
  const sampleUserMessage: ChatMessageType = {
    id: 'msg-1',
    role: 'user',
    content: 'How many hours did Kalin work last month?',
    timestamp: new Date(),
  };

  const sampleAssistantMessage: ChatMessageType = {
    id: 'msg-2',
    role: 'assistant',
    content: 'Kalin Tomanov logged **168.5 hours** last month across 2 projects:\n\n- **FoodCycleScience**: 120.0h\n- **Neocurrency**: 48.5h',
    timestamp: new Date(),
  };

  // Info card helper for molecules that need live data
  const infoCardMolecules = molecules.filter((m) =>
    ['CompanyGroupSection', 'ProjectGroupSection', 'PhysicalPersonGroupSection', 'UserAssociationsSection'].includes(m.name)
  );

  return (
    <div className="space-y-12">
      <div>
        <h2 className="text-lg font-semibold text-vercel-gray-600 mb-2">Official Molecules</h2>
        <p className="text-sm text-vercel-gray-400 mb-6">
          Collections of atoms organized with a specific intent.
          {' '}<span className="font-mono text-xs">{molecules.length} registered</span>
        </p>

        {/* DateCycle (existing) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">DateCycle</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/molecules/DateCycle.tsx</p>
          </div>
          <div className="space-y-6">
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">Default (size="md", variant="default")</p>
              <DateCycle selectedDate={dateCycleDate} onDateChange={setDateCycleDate} />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">Small (size="sm")</p>
              <DateCycle selectedDate={dateCycleDate} onDateChange={setDateCycleDate} size="sm" />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">Large (size="lg")</p>
              <DateCycle selectedDate={dateCycleDate} onDateChange={setDateCycleDate} size="lg" />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">Boxed variant (variant="boxed", size="md")</p>
              <DateCycle selectedDate={dateCycleDate} onDateChange={setDateCycleDate} variant="boxed" />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">Disabled</p>
              <DateCycle selectedDate={dateCycleDate} onDateChange={setDateCycleDate} disabled />
            </div>
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Month navigation with left/right arrows and centered date display. Three sizes (sm, md, lg), two variants (default, boxed), customizable date format.
            </p>
          </div>
        </div>

        {/* RangeSelector (existing) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">RangeSelector</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/RangeSelector.tsx</p>
          </div>
          <div className="space-y-6">
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">variant="dateRange"</p>
              <RangeSelector variant="dateRange" dateRange={rangeSelectorValue} onChange={setRangeSelectorValue} />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">variant="export"</p>
              <RangeSelector variant="export" dateRange={rangeSelectorValue} onChange={setRangeSelectorValue} onExport={() => {}} />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">variant="exportOnly"</p>
              <RangeSelector variant="exportOnly" onExport={() => {}} />
            </div>
            <div>
              <p className="text-xs text-vercel-gray-400 mb-3">variant="billings"</p>
              <RangeSelector variant="billings" dateRange={rangeSelectorValue} onChange={setRangeSelectorValue} onExport={() => {}} onAddBilling={() => {}} />
            </div>
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Four variants - dateRange, export, exportOnly, billings. Integrates DateCycle molecule for month navigation.
            </p>
          </div>
        </div>

        {/* DateRangeFilter (NEW) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">DateRangeFilter</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/DateRangeFilter.tsx</p>
          </div>
          <DateRangeFilter dateRange={dateRangeFilterValue} onChange={setDateRangeFilterValue} />
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Month navigation filter with previous/next buttons and formatted date display. Used on BillingsPage.
            </p>
          </div>
        </div>

        {/* MonthPicker (NEW) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">MonthPicker</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/MonthPicker.tsx</p>
          </div>
          <MonthPicker selectedMonth={monthPickerValue} onChange={setMonthPickerValue} />
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Month-level date picker for year/month combinations. Previous/next arrows, "Today" button, future month indicator badge.
            </p>
          </div>
        </div>

        {/* MetricCard (relocated from atoms) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-4">MetricCard</h3>
          <p className="text-xs text-vercel-gray-400 mb-4">Component: src/components/MetricCard.tsx</p>
          <div className="grid grid-cols-3 gap-4 max-w-xl">
            <MetricCard title="Total Hours" value="168.5" />
            <MetricCard title="Projects" value="12" />
            <MetricCard title="Revenue" value="$45,230" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 max-w-md">
            <MetricCard title="Resources Under Target" value="0" />
            <MetricCard title="Resources Under Target" value="3" isAlert onClick={() => {}} actionLabel="View" />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Props:</span> title, value, statusDot, isAlert, onClick, actionLabel, loading
            </p>
          </div>
        </div>

        {/* DatePicker (relocated from atoms) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">DatePicker (Dropdown Calendar)</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/DatePicker.tsx</p>
          </div>
          <div className="max-w-xs">
            <DatePicker value={datePickerValue} onChange={setDatePickerValue} placeholder="Select a date" />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Dropdown calendar with month navigation, today indicator (circle with 1px border), clear/today buttons.
            </p>
          </div>
        </div>

        {/* AvatarUpload (relocated from atoms) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-4">AvatarUpload</h3>
          <p className="text-xs text-vercel-gray-400 mb-4">Component: src/components/AvatarUpload.tsx</p>
          <div className="flex gap-8 items-start">
            <AvatarUpload name="Demo User" onImageCropped={() => {}} size={96} />
            <div className="flex-1">
              <div className="p-3 bg-vercel-gray-50 rounded-lg">
                <p className="text-xs text-vercel-gray-400">
                  <span className="font-medium">Features:</span> Click to upload, file validation (image types, max 10MB), circular crop modal with zoom control, outputs 256x256 JPEG blob.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* DropdownMenu (relocated from atoms) */}
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

        {/* AccordionFlat (relocated from atoms) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <h3 className="text-sm font-medium text-vercel-gray-600 mb-4">AccordionFlat (Billing Rates Pattern)</h3>
          <p className="text-xs text-vercel-gray-400 mb-4">Component: src/components/AccordionFlat.tsx — 2 levels: Header &gt; Table content with columns, rows, and optional footer.</p>
          <div className="max-w-2xl">
            <AccordionFlat
              header={
                <>
                  <h3 className="text-sm font-semibold text-vercel-gray-600">Billing Rates &amp; Revenue</h3>
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

        {/* ResourceRow (NEW) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">ResourceRow</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/ResourceRow.tsx</p>
          </div>
          <div className="max-w-xl border border-vercel-gray-100 rounded-lg overflow-hidden">
            <ResourceRow resource={mockResourceSummary} />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Expandable table row with chevron toggle and nested TaskList. Shows resource name and total hours.
            </p>
          </div>
        </div>

        {/* ProjectCard (NEW) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">ProjectCard</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/ProjectCard.tsx</p>
          </div>
          <div className="max-w-xl">
            <ProjectCard project={mockProjectSummary} />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Summary card for a project showing resource count, total hours, and nested AccordionNested for resource/task breakdown.
            </p>
          </div>
        </div>

        {/* TaskList (NEW) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">TaskList</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/TaskList.tsx</p>
          </div>
          <div className="max-w-xl">
            <TaskListComponent tasks={mockTaskSummaries} />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Grouped list of time entries organized by task with hours and date details. Compact card-style rows.
            </p>
          </div>
        </div>

        {/* PieChartAtom (relocated from atoms) */}
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

        {/* LineGraphAtom (relocated from atoms) */}
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
              <span className="font-medium">Features:</span> 12-month time series with Target (solid indigo), Budget (dashed purple), and Revenue (solid green) lines. Font-mono for axes, legend, tooltip.
            </p>
          </div>
        </div>

        {/* ChatMessage (NEW) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">ChatMessage</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/chat/ChatMessage.tsx</p>
          </div>
          <div className="max-w-md space-y-3">
            <ChatMessage message={sampleUserMessage} />
            <ChatMessage message={sampleAssistantMessage} />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> User messages (dark bg, right-aligned) and assistant messages (light bg, left-aligned) with Markdown rendering. Timestamp display.
            </p>
          </div>
        </div>

        {/* ChatInput (NEW) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">ChatInput</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/chat/ChatInput.tsx</p>
          </div>
          <div className="max-w-md">
            <ChatInput onSend={() => {}} placeholder="Ask about your data..." />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Auto-resize textarea with send button. Enter to send, Shift+Enter for newline. Optional clear button.
            </p>
          </div>
        </div>

        {/* Group management sections - info cards (API hooks fire on mount) */}
        {infoCardMolecules.map((mol) => (
          <div key={mol.name} className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-medium text-vercel-gray-600">{mol.name}</h3>
              <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">molecule</span>
            </div>
            <p className="text-xs text-vercel-gray-400 mb-3">{mol.description}</p>
            <p className="text-2xs text-vercel-gray-200 font-mono mb-3">{mol.filePath}</p>
            {mol.composedOf && mol.composedOf.length > 0 && (
              <div className="mb-3">
                <p className="text-2xs font-medium text-vercel-gray-400 mb-1">Composed of:</p>
                <div className="flex flex-wrap gap-1.5">
                  {mol.composedOf.map((dep) => (
                    <span key={dep} className="text-2xs font-mono px-2 py-0.5 bg-vercel-gray-50 text-vercel-gray-400 rounded">{dep}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="p-3 bg-warning-light border border-warning-medium rounded-lg">
              <p className="text-xs text-vercel-gray-400">
                <span className="font-medium text-vercel-gray-600">Requires live data:</span> Uses Supabase hooks on mount. Visit the corresponding editor modal in the app to see it in action.
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
