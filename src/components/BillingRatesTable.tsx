import { useState, useMemo } from 'react';
import {
  calculateProjectRevenue,
  getEffectiveRate,
  buildDbRateLookupByName,
} from '../utils/billing';
import { useProjects } from '../hooks/useProjects';
import { AccordionFlat } from './AccordionFlat';
import { ProjectEditorModal } from './ProjectEditorModal';
import { DropdownMenu } from './DropdownMenu';
import type { AccordionFlatColumn, AccordionFlatRow, AccordionFlatGroup } from './AccordionFlat';
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

  // Define columns for AccordionFlat
  const columns: AccordionFlatColumn[] = [
    { key: 'project', label: 'Project', align: 'left' },
    { key: 'rate', label: 'Rate ($/hr)', align: 'right' },
  ];

  // Helper to build a row for a project
  const buildProjectRow = (project: ProjectSummary): AccordionFlatRow => {
    const effectiveRate = getEffectiveRate(project.projectName, dbRateLookup, {});
    const hasDbRate = dbRateLookup.has(project.projectName);

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

    // Rate cell with action dropdown - use bteam-brand for undefined rates
    const rateContent = hasDbRate ? (
      <span className="text-sm text-vercel-gray-600">
        ${effectiveRate.toFixed(2)}
      </span>
    ) : (
      <span className="text-sm text-bteam-brand">
        ${effectiveRate.toFixed(2)} <span className="text-2xs">(default)</span>
      </span>
    );

    return {
      id: project.projectName,
      cells: {
        project: <span className={hasDbRate ? "text-vercel-gray-600" : "text-bteam-brand"}>{project.projectName}</span>,
        rate: (
          <div className="flex items-center justify-end">
            {rateContent}
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
      result.push({
        id: clientName,
        label: clientName,
        // Include invisible spacer (ml-4 + w-6 = 40px) to align with project row icons
        labelRight: (
          <div className="flex items-center">
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

  // No footer needed for rates-only view

  return (
    <>
      <AccordionFlat
        alwaysExpanded={true}
        columns={columns}
        groups={groups}
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
