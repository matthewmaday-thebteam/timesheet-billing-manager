/**
 * OrganismsSection - Organism Component Previews
 *
 * 15 live previews (props-based, no internal API hooks)
 * 11 enhanced info cards (internal Supabase hooks fire on mount)
 * 1 info card for RateEditModal (useSingleProjectRate fires on mount)
 */

import { useState } from 'react';
import { Button } from '../../../components/Button';
import { StatsOverview } from '../../../components/StatsOverview';
import { ResourceTable } from '../../../components/ResourceTable';
import { BurnGrid } from '../../../components/atoms/BurnGrid';
import { HolidayTable } from '../../../components/HolidayTable';
import { HolidayCalendar } from '../../../components/HolidayCalendar';
import { EmployeeTimeOffList } from '../../../components/EmployeeTimeOffList';
import { UserTable } from '../../../components/UserTable';
import { UserEditorModal } from '../../../components/UserEditorModal';
import { HolidayEditorModal } from '../../../components/HolidayEditorModal';
import { LegalModal } from '../../../components/LegalModal';
import { UnderHoursModal } from '../../../components/UnderHoursModal';
import { DashboardChartsRow } from '../../../components/DashboardChartsRow';
import { AIChatWindow } from '../../../components/chat/AIChatWindow';
import { AccordionNested } from '../../../components/AccordionNested';
import type { AccordionNestedLevel2Item } from '../../../components/AccordionNested';
import { AccordionListTable } from '../../../components/AccordionListTable';
import type { AccordionListTableColumn, AccordionListTableItem } from '../../../components/AccordionListTable';
import { organisms } from '../../registry/organisms';
import {
  mockProjectSummaries,
  mockResourceSummaries,
  mockResources,
  mockBurnGridData,
  mockHolidays,
  mockTimeOff,
  mockAppUsers,
  mockUnderHoursResources,
  mockTimesheetEntries,
} from '../mockData';

// Components that require live Supabase data (hooks fire on mount)
const INFO_CARD_NAMES = new Set([
  'BillingRatesTable',
  'MainHeader',
  'Footer',
  'EmployeeEditorModal',
  'CompanyEditorModal',
  'ProjectEditorModal',
  'ProfileEditorModal',
  'BambooEmployeePanel',
  'EmployeePerformance',
  'ProjectHierarchyTable',
  'RevenueTable',
  'RateEditModal',
]);

// Hook names for info card descriptions
const HOOK_NAMES: Record<string, string> = {
  BillingRatesTable: 'useMonthlyRates, useBillingLimits',
  MainHeader: 'useAuth, useNavigate',
  Footer: 'useLegalDocuments',
  EmployeeEditorModal: 'useEmploymentTypes, useUnassociatedPhysicalPersons',
  CompanyEditorModal: 'useUnassociatedCompanies',
  ProjectEditorModal: 'useUnassociatedProjects',
  ProfileEditorModal: 'useAuth, useProfileUpdate',
  BambooEmployeePanel: 'useBambooEmployees',
  EmployeePerformance: 'useTimesheetData',
  ProjectHierarchyTable: 'useTimesheetData',
  RevenueTable: 'useTimesheetData',
  RateEditModal: 'useSingleProjectRate',
};

// Page names for info card descriptions
const PAGE_NAMES: Record<string, string> = {
  BillingRatesTable: 'Rates page',
  MainHeader: 'any authenticated page',
  Footer: 'any page (footer)',
  EmployeeEditorModal: 'Employee Management page',
  CompanyEditorModal: 'Company Management page',
  ProjectEditorModal: 'Project Management page',
  ProfileEditorModal: 'header profile menu',
  BambooEmployeePanel: 'Employee Management page',
  EmployeePerformance: 'Employees page',
  ProjectHierarchyTable: 'Revenue page',
  RevenueTable: 'Revenue page',
  RateEditModal: 'Rates page',
};

export function OrganismsSection() {
  const [userEditorOpen, setUserEditorOpen] = useState(false);
  const [holidayEditorOpen, setHolidayEditorOpen] = useState(false);
  const [legalModalOpen, setLegalModalOpen] = useState(false);
  const [underHoursModalOpen, setUnderHoursModalOpen] = useState(false);
  const [chatWindowOpen, setChatWindowOpen] = useState(false);

  const currentYear = new Date().getFullYear();

  // BurnGrid date range (5 days)
  const burnStart = new Date(currentYear, 1, 10);
  const burnEnd = new Date(currentYear, 1, 14);

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

  // Organisms that require live Supabase data (rendered as info cards)
  const infoCardOrganisms = organisms.filter((o) => INFO_CARD_NAMES.has(o.name));

  return (
    <div className="space-y-12">
      <div>
        <h2 className="text-lg font-semibold text-vercel-gray-600 mb-2">Organisms</h2>
        <p className="text-sm text-vercel-gray-400 mb-6">
          Collections of molecules and atoms composed for a specific on-screen purpose.
          {' '}<span className="font-mono text-xs">{organisms.length} registered</span>
        </p>

        {/* ----------------------------------------------------------------- */}
        {/* LIVE PREVIEWS                                                      */}
        {/* ----------------------------------------------------------------- */}

        {/* StatsOverview */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">StatsOverview</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/StatsOverview.tsx</p>
          </div>
          <StatsOverview
            projects={mockProjectSummaries}
            projectCount={2}
            resources={mockResourceSummaries}
            underHoursCount={2}
            totalRevenue={45230}
            utilizationPercent={82}
            onUnderHoursClick={() => setUnderHoursModalOpen(true)}
          />
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Row of MetricCards showing total hours, utilization, revenue status, project/resource counts, and under-target alerts.
            </p>
          </div>
        </div>

        {/* DashboardChartsRow */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">DashboardChartsRow</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/DashboardChartsRow.tsx</p>
          </div>
          <DashboardChartsRow
            resources={mockResourceSummaries}
            entries={mockTimesheetEntries}
            projectRates={new Map([['p-1', 60], ['p-2', 53]])}
            combinedRevenueByMonth={new Map()}
            section="resources"
          />
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Two-row responsive grid with pie chart (hours by resource), top-5 lists, and revenue trend charts. Showing "resources" section only.
            </p>
          </div>
        </div>

        {/* ResourceTable */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">ResourceTable</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/ResourceTable.tsx</p>
          </div>
          <ResourceTable resources={mockResources} loading={false} onRowClick={() => {}} />
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Sortable table of employee records with name, email, employment type, and status columns.
            </p>
          </div>
        </div>

        {/* BurnGrid */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">BurnGrid</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/atoms/BurnGrid.tsx</p>
          </div>
          <BurnGrid data={mockBurnGridData} startDate={burnStart} endDate={burnEnd} />
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Employee x Day matrix showing hours worked. Under-hours cells can be highlighted. Horizontal scroll for wide date ranges.
            </p>
          </div>
        </div>

        {/* AccordionNested (Projects Pattern) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">AccordionNested (Projects Pattern)</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/AccordionNested.tsx — 3 levels: Project &gt; Resource &gt; Task breakdown. Left border line indicates hierarchy.</p>
          </div>
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

        {/* AccordionListTable (Resources Under Target Pattern) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">AccordionListTable (Resources Under Target Pattern)</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/AccordionListTable.tsx — Multiple expandable items, each with table content. Optional status indicator dot.</p>
          </div>
          <div className="max-w-2xl">
            <AccordionListTable columns={sampleListTableColumns} items={sampleListTableItems} />
          </div>
        </div>

        {/* HolidayTable */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">HolidayTable</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/HolidayTable.tsx</p>
          </div>
          <HolidayTable holidays={mockHolidays} loading={false} year={currentYear} onEdit={() => {}} onDelete={() => {}} />
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Table of holidays with name, date, type columns, and edit/delete actions via DropdownMenu.
            </p>
          </div>
        </div>

        {/* HolidayCalendar (relocated from atoms) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">HolidayCalendar</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/HolidayCalendar.tsx</p>
          </div>
          <div className="max-w-sm">
            <HolidayCalendar holidays={mockHolidays} timeOff={mockTimeOff} year={currentYear} onDateClick={() => {}} />
          </div>
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Inline month view with holiday highlighting, today indicator, employee time-off overlay, legend, month navigation.
            </p>
          </div>
        </div>

        {/* EmployeeTimeOffList */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">EmployeeTimeOffList</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/EmployeeTimeOffList.tsx</p>
          </div>
          <EmployeeTimeOffList timeOff={mockTimeOff} loading={false} year={currentYear} />
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Table of employee time-off records with name, dates, type, and status columns. Synced from BambooHR.
            </p>
          </div>
        </div>

        {/* UserTable */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">UserTable</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/UserTable.tsx</p>
          </div>
          <UserTable users={mockAppUsers} loading={false} adminCount={2} onEdit={() => {}} onDelete={() => {}} onResetPassword={() => {}} />
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Table of admin users with email, role, status columns, and row-click editing. DropdownMenu for actions.
            </p>
          </div>
        </div>

        {/* UserEditorModal (create mode) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">UserEditorModal</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/UserEditorModal.tsx</p>
          </div>
          <Button variant="secondary" onClick={() => setUserEditorOpen(true)}>Open User Editor (Create Mode)</Button>
          <UserEditorModal
            isOpen={userEditorOpen}
            onClose={() => setUserEditorOpen(false)}
            user={null}
            onSave={async () => { setUserEditorOpen(false); }}
            onUpdateRole={async () => {}}
            isSaving={false}
            adminCount={2}
          />
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Modal for creating/editing admin users with role, status toggles, and resource associations. Null user = create mode.
            </p>
          </div>
        </div>

        {/* HolidayEditorModal (create mode) */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">HolidayEditorModal</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/HolidayEditorModal.tsx</p>
          </div>
          <Button variant="secondary" onClick={() => setHolidayEditorOpen(true)}>Open Holiday Editor (Create Mode)</Button>
          <HolidayEditorModal
            isOpen={holidayEditorOpen}
            onClose={() => setHolidayEditorOpen(false)}
            holiday={null}
            onSave={async () => { setHolidayEditorOpen(false); return true; }}
            onUpdate={async () => true}
            isSaving={false}
            defaultYear={currentYear}
          />
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Modal for creating/editing holidays with date picker, name input, and save/cancel buttons.
            </p>
          </div>
        </div>

        {/* LegalModal */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">LegalModal</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/LegalModal.tsx</p>
          </div>
          <Button variant="secondary" onClick={() => setLegalModalOpen(true)}>Open Legal Modal</Button>
          <LegalModal
            isOpen={legalModalOpen}
            onClose={() => setLegalModalOpen(false)}
            title="Terms of Service"
            content={`**Terms of Service**\n\nLast updated: January 2026\n\n**1. Acceptance of Terms**\nBy accessing and using this application, you accept and agree to be bound by these terms.\n\n**2. Use of Service**\nYou agree to use the service only for lawful purposes and in accordance with these terms.\n\n**3. Data Privacy**\nWe respect your privacy. Please refer to our Privacy Policy for details on how we handle your data.`}
            version={1}
            lastUpdated="2026-01-01"
          />
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Full-screen modal displaying legal documents with Markdown rendering, version number, and last updated date.
            </p>
          </div>
        </div>

        {/* UnderHoursModal */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">UnderHoursModal</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/UnderHoursModal.tsx</p>
          </div>
          <Button variant="secondary" onClick={() => setUnderHoursModalOpen(true)}>Open Under Hours Modal</Button>
          <UnderHoursModal
            isOpen={underHoursModalOpen}
            onClose={() => setUnderHoursModalOpen(false)}
            items={mockUnderHoursResources}
            entries={mockTimesheetEntries}
            expectedHours={35}
            workingDaysElapsed={10}
            workingDaysTotal={22}
          />
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Modal showing employees under target hours with MetricCards summary and AccordionListTable breakdown by employee and project.
            </p>
          </div>
        </div>

        {/* AIChatWindow */}
        <div className="mb-8 p-6 border border-vercel-gray-100 rounded-lg">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-vercel-gray-600">AIChatWindow</h3>
            <p className="text-xs text-vercel-gray-400">Component: src/components/chat/AIChatWindow.tsx</p>
          </div>
          <Button variant="secondary" onClick={() => setChatWindowOpen(true)}>Open Chat Window</Button>
          <AIChatWindow isOpen={chatWindowOpen} onClose={() => setChatWindowOpen(false)} />
          <div className="mt-4 p-3 bg-vercel-gray-50 rounded-lg">
            <p className="text-xs text-vercel-gray-400">
              <span className="font-medium">Features:</span> Floating chat panel with message list, typing indicator, and input area. Idle state renders without API call; sending a message triggers the AI backend.
            </p>
          </div>
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* ENHANCED INFO CARDS (require live Supabase backend)                */}
        {/* ----------------------------------------------------------------- */}

        <h3 className="text-sm font-semibold text-vercel-gray-600 mt-12 mb-4">
          Components Requiring Live Data
        </h3>
        <p className="text-xs text-vercel-gray-400 mb-6">
          These organisms use Supabase hooks that fire on mount. Visit the corresponding page in the live app to see them.
        </p>

        <div className="grid gap-4">
          {infoCardOrganisms.map((org) => (
            <div key={org.name} className="p-6 border border-vercel-gray-100 rounded-lg">
              <div className="flex items-start justify-between mb-2">
                <h4 className="text-sm font-medium text-vercel-gray-600">{org.name}</h4>
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">
                  organism
                </span>
              </div>
              <p className="text-xs text-vercel-gray-400 mb-3">{org.description}</p>
              <p className="text-2xs text-vercel-gray-200 font-mono mb-3">{org.filePath}</p>

              {org.composedOf && org.composedOf.length > 0 && (
                <div className="mb-3">
                  <p className="text-2xs font-medium text-vercel-gray-400 mb-1">Composed of:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {org.composedOf.map((dep) => (
                      <span
                        key={dep}
                        className="text-2xs font-mono px-2 py-0.5 bg-vercel-gray-50 text-vercel-gray-400 rounded"
                      >
                        {dep}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-3 bg-warning-light border border-warning-medium rounded-lg">
                <p className="text-xs text-vercel-gray-400">
                  <span className="font-medium text-vercel-gray-600">Requires live data:</span>{' '}
                  Uses <span className="font-mono text-brand-indigo">{HOOK_NAMES[org.name] || 'Supabase hooks'}</span> which connect to the backend on mount.
                  Visit the <span className="font-medium">{PAGE_NAMES[org.name] || 'app'}</span> to see it in action.
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
