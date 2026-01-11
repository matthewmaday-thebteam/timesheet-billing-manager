/**
 * EmployeePerformance - Dashboard component showing employee hours and revenue
 *
 * Uses AccordionFlat atom with Billing Rates Pattern styling.
 *
 * @category Component
 */

import { useMemo } from 'react';
import { AccordionFlat } from './AccordionFlat';
import type { AccordionFlatColumn, AccordionFlatRow, AccordionFlatFooterCell } from './AccordionFlat';
import type { ProjectSummary } from '../types';
import { getEffectiveRate, formatCurrency, getBillingRates } from '../utils/billing';
import { minutesToHours } from '../utils/calculations';

interface EmployeePerformanceProps {
  /** Project summaries with resource data */
  projects: ProjectSummary[];
  /** Database rate lookup by project name */
  dbRateLookup: Map<string, number>;
}

interface EmployeeData {
  name: string;
  totalMinutes: number;
  revenue: number;
}

export function EmployeePerformance({ projects, dbRateLookup }: EmployeePerformanceProps) {
  const legacyRates = getBillingRates();

  // Aggregate employee data across all projects
  const employeeData = useMemo(() => {
    const employeeMap = new Map<string, EmployeeData>();

    projects.forEach((project) => {
      const rate = getEffectiveRate(project.projectName, dbRateLookup, legacyRates);

      project.resources.forEach((resource) => {
        const name = resource.displayName || resource.userName;
        const existing = employeeMap.get(name);
        const resourceRevenue = (resource.totalMinutes / 60) * rate;

        if (existing) {
          existing.totalMinutes += resource.totalMinutes;
          existing.revenue += resourceRevenue;
        } else {
          employeeMap.set(name, {
            name,
            totalMinutes: resource.totalMinutes,
            revenue: resourceRevenue,
          });
        }
      });
    });

    // Convert to array and sort by revenue (highest first)
    return Array.from(employeeMap.values()).sort((a, b) => b.revenue - a.revenue);
  }, [projects, dbRateLookup, legacyRates]);

  // Calculate totals
  const totalMinutes = employeeData.reduce((sum, emp) => sum + emp.totalMinutes, 0);
  const totalRevenue = employeeData.reduce((sum, emp) => sum + emp.revenue, 0);

  // Define columns
  const columns: AccordionFlatColumn[] = [
    { key: 'employee', label: 'Employee', align: 'left' },
    { key: 'hours', label: 'Hours', align: 'right' },
    { key: 'revenue', label: 'Revenue', align: 'right' },
  ];

  // Build rows
  const rows: AccordionFlatRow[] = employeeData.map((emp) => ({
    id: emp.name,
    cells: {
      employee: <span className="text-vercel-gray-600">{emp.name}</span>,
      hours: <span className="text-vercel-gray-400">{minutesToHours(emp.totalMinutes)}</span>,
      revenue: (
        <span className={`font-medium ${emp.revenue > 0 ? 'text-vercel-gray-600' : 'text-vercel-gray-300'}`}>
          {formatCurrency(emp.revenue)}
        </span>
      ),
    },
  }));

  // Footer cells
  const footer: AccordionFlatFooterCell[] = [
    { columnKey: 'employee', content: 'Total' },
    { columnKey: 'hours', content: minutesToHours(totalMinutes) },
    { columnKey: 'revenue', content: formatCurrency(totalRevenue) },
  ];

  if (employeeData.length === 0) {
    return null;
  }

  return (
    <AccordionFlat
      header={
        <>
          <h3 className="text-lg font-semibold text-vercel-gray-600">Employee Performance</h3>
          <p className="text-xs font-mono text-vercel-gray-400">
            Hours and Revenue for {employeeData.length} team {employeeData.length === 1 ? 'member' : 'members'}
          </p>
        </>
      }
      headerRight={
        <div className="text-right">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-success" />
            <span className="text-lg font-semibold text-vercel-gray-600">{formatCurrency(totalRevenue)}</span>
          </div>
          <div className="text-xs font-mono text-vercel-gray-400">total revenue</div>
        </div>
      }
      columns={columns}
      rows={rows}
      footer={footer}
    />
  );
}

export default EmployeePerformance;
