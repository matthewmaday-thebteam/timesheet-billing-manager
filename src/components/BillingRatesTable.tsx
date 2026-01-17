import { useState, useMemo } from 'react';
import {
  calculateProjectRevenue,
  formatCurrency,
  getEffectiveRate,
  buildDbRateLookupByName,
} from '../utils/billing';
import { minutesToHours } from '../utils/calculations';
import { useProjects } from '../hooks/useProjects';
import { AccordionFlat } from './AccordionFlat';
import { ProjectEditorModal } from './ProjectEditorModal';
import { DropdownMenu } from './DropdownMenu';
import type { AccordionFlatColumn, AccordionFlatRow, AccordionFlatFooterCell, AccordionFlatGroup } from './AccordionFlat';
import type { ProjectSummary, Project } from '../types';

interface BillingRatesTableProps {
  projects: ProjectSummary[];
  onRatesChange: () => void;
}

export function BillingRatesTable({ projects, onRatesChange }: BillingRatesTableProps) {
  // Get database projects and update function
  const { projects: dbProjects, updateProject, isOperating } = useProjects();
  const dbRateLookup = useMemo(() => buildDbRateLookupByName(dbProjects), [dbProjects]);

  // Build lookup from project name to Project object
  const projectByName = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of dbProjects) {
      map.set(p.project_name, p);
    }
    return map;
  }, [dbProjects]);

  // Modal state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  const handleEditClick = (projectName: string) => {
    const project = projectByName.get(projectName);
    if (project) {
      setSelectedProject(project);
      setIsEditorOpen(true);
    }
  };

  const handleCloseEditor = () => {
    setIsEditorOpen(false);
    setSelectedProject(null);
  };

  const handleSaveRate = async (id: string, data: { rate: number | null }) => {
    const success = await updateProject(id, data);
    if (success) {
      onRatesChange();
    }
    return success;
  };

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

    // Rate cell content (display only)
    const rateCell = hasDbRate ? (
      <span className="text-sm text-vercel-gray-600">
        ${effectiveRate.toFixed(2)}
      </span>
    ) : (
      <span className="text-sm text-vercel-gray-300">
        ${effectiveRate.toFixed(2)} <span className="text-2xs">(default)</span>
      </span>
    );

    // Actions dropdown
    const menuItems = [
      {
        label: 'Edit Rate',
        onClick: () => handleEditClick(project.projectName),
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        ),
      },
    ];

    return {
      id: project.projectName,
      cells: {
        project: <span className="text-vercel-gray-600">{project.projectName}</span>,
        hours: <span className="text-vercel-gray-400">{minutesToHours(project.totalMinutes)}</span>,
        rate: rateCell,
        // Revenue cell includes the action icon with flexbox layout
        revenue: (
          <div className="flex items-center justify-end">
            <span className={`font-medium ${revenue > 0 ? 'text-vercel-gray-600' : 'text-vercel-gray-300'}`}>
              {formatCurrency(revenue)}
            </span>
            {/* 16px gap (ml-4) + fixed width icon (w-6 = 24px) */}
            <div className="ml-4 w-6 shrink-0 flex justify-center" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu items={menuItems} />
            </div>
          </div>
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
      const groupMinutes = clientProjects.reduce((sum, p) => sum + p.totalMinutes, 0);
      const groupRevenue = clientProjects.reduce(
        (sum, p) => sum + calculateProjectRevenue(p, {}, dbRateLookup),
        0
      );

      result.push({
        id: clientName,
        label: clientName,
        // Include invisible spacer (ml-4 + w-6 = 40px) to align with project row icons
        labelRight: (
          <div className="flex items-center">
            <span className="text-vercel-gray-400">
              {minutesToHours(groupMinutes)}h · {formatCurrency(groupRevenue)}
            </span>
            {/* Invisible spacer matching icon container: 16px gap + 24px icon width */}
            <div className="ml-4 w-6 shrink-0" />
          </div>
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

  // Footer cells (revenue includes spacer for alignment)
  const footer: AccordionFlatFooterCell[] = [
    { columnKey: 'project', content: 'Total' },
    { columnKey: 'hours', content: minutesToHours(projects.reduce((sum, p) => sum + p.totalMinutes, 0)) },
    { columnKey: 'rate', content: null },
    {
      columnKey: 'revenue',
      content: (
        <div className="flex items-center justify-end">
          <span>{formatCurrency(totalRevenue)}</span>
          {/* Invisible spacer matching icon container: 16px gap + 24px icon width */}
          <div className="ml-4 w-6 shrink-0" />
        </div>
      )
    },
  ];

  return (
    <>
      <AccordionFlat
        header={
          <>
            <h3 className="text-lg font-semibold text-vercel-gray-600">Billing Rates & Revenue</h3>
            <p className="text-xs font-mono text-vercel-gray-400">Projects grouped by company</p>
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
        groups={groups}
        footer={footer}
      />

      {/* Editor Modal */}
      <ProjectEditorModal
        isOpen={isEditorOpen}
        onClose={handleCloseEditor}
        project={selectedProject}
        onSave={handleSaveRate}
        isSaving={isOperating}
      />
    </>
  );
}
