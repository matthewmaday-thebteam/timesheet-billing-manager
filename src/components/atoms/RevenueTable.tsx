/**
 * RevenueTable - Official Design System Atom
 *
 * A revenue-focused table component that displays project billing data.
 * Always expanded by default for immediate visibility.
 *
 * @official 2026-01-22
 * @category Atom
 *
 * Token Usage:
 * - Background: white, vercel-gray-50 (header/footer)
 * - Border: vercel-gray-100
 * - Text: vercel-gray-600, vercel-gray-400, vercel-gray-300
 * - Accent: success (revenue indicator)
 * - Radius: rounded-lg
 */

import { useMemo } from 'react';
import {
  calculateProjectRevenue,
  formatCurrency,
  getEffectiveRate,
  buildDbRateLookupByName,
} from '../../utils/billing';
import { minutesToHours } from '../../utils/calculations';
import { useProjects } from '../../hooks/useProjects';
import { AccordionFlat } from '../AccordionFlat';
import type { AccordionFlatColumn, AccordionFlatRow, AccordionFlatFooterCell, AccordionFlatGroup } from '../AccordionFlat';
import type { ProjectSummary } from '../../types';

interface RevenueTableProps {
  projects: ProjectSummary[];
}

export function RevenueTable({ projects }: RevenueTableProps) {
  // Get database projects for rate lookup
  const { projects: dbProjects } = useProjects();
  const dbRateLookup = useMemo(() => buildDbRateLookupByName(dbProjects), [dbProjects]);

  // Sort projects by revenue (highest first)
  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const revenueA = calculateProjectRevenue(a, {}, dbRateLookup);
      const revenueB = calculateProjectRevenue(b, {}, dbRateLookup);
      return revenueB - revenueA;
    });
  }, [projects, dbRateLookup]);

  const totalRevenue = useMemo(() => {
    return sortedProjects.reduce(
      (sum, p) => sum + calculateProjectRevenue(p, {}, dbRateLookup),
      0
    );
  }, [sortedProjects, dbRateLookup]);

  // Define columns for AccordionFlat (no separate actions column - icon is inside revenue cell)
  const columns: AccordionFlatColumn[] = [
    { key: 'project', label: 'Project', align: 'left' },
    { key: 'hours', label: 'Hours', align: 'right' },
    { key: 'rate', label: 'Rate ($/hr)', align: 'right' },
    { key: 'revenue', label: 'Revenue', align: 'right' },
  ];

  // Helper to build a row for a project
  const buildProjectRow = (project: ProjectSummary): AccordionFlatRow => {
    const effectiveRate = getEffectiveRate(project.projectName, dbRateLookup, {});
    const hasDbRate = dbRateLookup.has(project.projectName);
    const revenue = calculateProjectRevenue(project, {}, dbRateLookup);

    // Rate cell content (display only) - use gray-200 for all project row text
    const rateCell = hasDbRate ? (
      <span className="text-sm text-vercel-gray-200">
        ${effectiveRate.toFixed(2)}
      </span>
    ) : (
      <span className="text-sm text-vercel-gray-200">
        ${effectiveRate.toFixed(2)} <span className="text-2xs">(default)</span>
      </span>
    );

    return {
      id: project.projectName,
      cells: {
        project: <span className="text-vercel-gray-200">{project.projectName}</span>,
        hours: <span className="text-vercel-gray-200">{minutesToHours(project.totalMinutes)}</span>,
        rate: rateCell,
        revenue: (
          <span className="text-vercel-gray-200">
            {formatCurrency(revenue)}
          </span>
        ),
      },
    };
  };

  // Group projects by company/client
  const groupedByCompany = useMemo(() => {
    const groupMap = new Map<string, ProjectSummary[]>();

    for (const project of sortedProjects) {
      const clientName = project.clientName || 'Unassigned';
      if (!groupMap.has(clientName)) {
        groupMap.set(clientName, []);
      }
      groupMap.get(clientName)!.push(project);
    }

    return groupMap;
  }, [sortedProjects]);

  // Build groups for AccordionFlat
  const groups: AccordionFlatGroup[] = useMemo(() => {
    const result: AccordionFlatGroup[] = [];

    for (const [clientName, clientProjects] of groupedByCompany) {
      // Calculate group totals
      const groupRevenue = clientProjects.reduce(
        (sum, p) => sum + calculateProjectRevenue(p, {}, dbRateLookup),
        0
      );

      result.push({
        id: clientName,
        label: clientName,
        labelRight: (
          <span className="text-black font-medium">
            {formatCurrency(groupRevenue)}
          </span>
        ),
        rows: clientProjects.map(buildProjectRow),
      });
    }

    // Sort groups by revenue (highest first)
    return result.sort((a, b) => {
      const revenueA = groupedByCompany.get(a.id)!.reduce(
        (sum, p) => sum + calculateProjectRevenue(p, {}, dbRateLookup),
        0
      );
      const revenueB = groupedByCompany.get(b.id)!.reduce(
        (sum, p) => sum + calculateProjectRevenue(p, {}, dbRateLookup),
        0
      );
      return revenueB - revenueA;
    });
  }, [groupedByCompany, dbRateLookup]);

  // Footer cells
  const footer: AccordionFlatFooterCell[] = [
    { columnKey: 'project', content: 'Total' },
    { columnKey: 'hours', content: minutesToHours(projects.reduce((sum, p) => sum + p.totalMinutes, 0)) },
    { columnKey: 'rate', content: null },
    { columnKey: 'revenue', content: formatCurrency(totalRevenue) },
  ];

  return (
    <AccordionFlat
      alwaysExpanded={true}
      columns={columns}
      groups={groups}
      footer={footer}
    />
  );
}

export default RevenueTable;
