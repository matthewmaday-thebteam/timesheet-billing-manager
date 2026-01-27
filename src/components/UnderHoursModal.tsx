import { useMemo } from 'react';
import { format } from 'date-fns';
import { Modal } from './Modal';
import { MetricCard } from './MetricCard';
import { Card } from './Card';
import { AccordionListTable } from './AccordionListTable';
import type { AccordionListTableColumn, AccordionListTableItem } from './AccordionListTable';
import { minutesToHours } from '../utils/calculations';
import type { UnderHoursResource } from '../utils/calculations';
import type { TimesheetEntry } from '../types';

interface UnderHoursModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: UnderHoursResource[];
  entries: TimesheetEntry[];
  expectedHours: number;
  workingDaysElapsed: number;
  workingDaysTotal: number;
  /** Lookup from user_id to CANONICAL display name (for proper entry filtering) */
  userIdToDisplayNameLookup?: Map<string, string>;
}

// Table columns for task breakdown
const taskColumns: AccordionListTableColumn[] = [
  { key: 'client', label: 'Client', align: 'left' },
  { key: 'date', label: 'Date', align: 'left' },
  { key: 'task', label: 'Task', align: 'left' },
  { key: 'time', label: 'Time', align: 'right' },
];

export function UnderHoursModal({
  isOpen,
  onClose,
  items,
  entries,
  expectedHours,
  workingDaysElapsed,
  workingDaysTotal,
  userIdToDisplayNameLookup,
}: UnderHoursModalProps) {
  // Build accordion items from under-hours resources
  const accordionItems: AccordionListTableItem[] = useMemo(() => {
    return items.map((item) => {
      // Get task entries for this user, sorted by Client -> Date (desc) -> Task
      // Use canonical display name matching via userIdToDisplayNameLookup for proper grouping
      const userEntries = entries
        .filter((e) => {
          // Match by canonical display name if lookup is available
          if (userIdToDisplayNameLookup && e.user_id) {
            const canonicalName = userIdToDisplayNameLookup.get(e.user_id);
            return canonicalName === item.displayName;
          }
          // Fallback to raw user_name match
          return e.user_name === item.userName;
        })
        .map((entry) => ({
          client: entry.project_name,
          date: entry.work_date,
          task: entry.task_name,
          minutes: entry.total_minutes,
        }))
        .sort((a, b) => {
          const clientCompare = a.client.localeCompare(b.client);
          if (clientCompare !== 0) return clientCompare;
          const dateCompare = b.date.localeCompare(a.date);
          if (dateCompare !== 0) return dateCompare;
          return a.task.localeCompare(b.task);
        });

      // Convert to table rows
      const rows = userEntries.map((task, index) => ({
        id: `${task.client}-${task.date}-${task.task}-${index}`,
        cells: {
          client: (
            <span className="text-vercel-gray-600 font-medium">{task.client}</span>
          ),
          date: (
            <span className="text-vercel-gray-400 font-mono">
              {format(new Date(task.date), 'MMM d')}
            </span>
          ),
          task: (
            <span className="text-vercel-gray-400 font-mono max-w-[200px] truncate block">
              {task.task}
            </span>
          ),
          time: (
            <span className="text-vercel-gray-600 font-medium">
              {minutesToHours(task.minutes)}h
            </span>
          ),
        },
      }));

      return {
        id: item.userName,
        statusColor: 'error' as const,
        headerLeft: (
          <span className="text-sm font-medium text-vercel-gray-600">
            {item.displayName}
          </span>
        ),
        headerRight: (
          <div className="text-right">
            <span className="text-sm font-medium text-vercel-gray-600">
              {item.actualHours.toFixed(1)}h
            </span>
            <span className="text-sm text-vercel-gray-400 mx-1">/</span>
            <span className="text-sm font-mono text-vercel-gray-400">
              {item.expectedHours.toFixed(1)}h
            </span>
            <span className="text-sm font-mono text-bteam-brand ml-3">
              -{item.deficit.toFixed(1)}h
            </span>
          </div>
        ),
        rows,
        emptyMessage: 'No tasks recorded for this period',
      };
    });
  }, [items, entries, userIdToDisplayNameLookup]);

  // Sticky header content (summary cards + info banner)
  const stickyHeaderContent = (
    <div className="space-y-4 pb-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4">
        <MetricCard title="Prorated Target" value={`${expectedHours.toFixed(1)} hrs`} />
        <MetricCard title="Working Days" value={`${workingDaysElapsed} / ${workingDaysTotal}`} />
      </div>

      {/* Info Banner */}
      <Card padding="md">
        <div className="flex items-start gap-3">
          <div className="w-2 h-2 rounded-full bg-warning mt-1.5 flex-shrink-0" />
          <div>
            <p className="text-sm text-vercel-gray-600 font-medium">Monthly Target: 140 hours</p>
            <p className="text-xs text-vercel-gray-400 mt-1">
              Working days exclude weekends and Bulgarian public holidays
            </p>
          </div>
        </div>
      </Card>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Resources Under Target"
      maxWidth="3xl"
      stickyHeader={stickyHeaderContent}
    >
      {/* Resource List */}
      {items.length === 0 ? (
        <div className="text-center py-8">
          <div className="w-2.5 h-2.5 rounded-full bg-success mx-auto mb-3" />
          <p className="text-sm text-vercel-gray-400">All resources are on target</p>
        </div>
      ) : (
        <AccordionListTable items={accordionItems} columns={taskColumns} />
      )}
    </Modal>
  );
}
