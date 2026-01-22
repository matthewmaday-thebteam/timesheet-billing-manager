import { useState, useMemo } from 'react';
import { AccordionFlat } from './AccordionFlat';
import { RateEditModal } from './RateEditModal';
import { DropdownMenu } from './DropdownMenu';
import { formatRateMonth } from '../hooks/useRateHistory';
import type { AccordionFlatColumn, AccordionFlatRow, AccordionFlatGroup } from './AccordionFlat';
import type { ProjectRateDisplay, MonthSelection, RateSource } from '../types';

interface BillingRatesTableProps {
  projectsWithRates: ProjectRateDisplay[];
  selectedMonth: MonthSelection;
  onUpdateRate: (projectId: string, month: MonthSelection, rate: number) => Promise<boolean>;
  onRatesChange: () => void;
}

/**
 * Get color class for rate source indicator dot
 */
function getSourceDotColor(source: RateSource): string {
  switch (source) {
    case 'explicit':
      return 'bg-green-500';
    case 'inherited':
    case 'backfill':
      return 'bg-blue-500';
    case 'default':
      return 'bg-vercel-gray-300';
    default:
      return 'bg-vercel-gray-300';
  }
}

/**
 * Get secondary text for rate (source info)
 */
function getSourceLabel(project: ProjectRateDisplay): string | null {
  switch (project.source) {
    case 'explicit':
      return null; // No label needed for explicit
    case 'inherited':
      return project.sourceMonth ? `from ${formatRateMonth(project.sourceMonth)}` : 'inherited';
    case 'backfill':
      return project.sourceMonth ? `from ${formatRateMonth(project.sourceMonth)}` : 'backfill';
    case 'default':
      return 'default';
    default:
      return null;
  }
}

export function BillingRatesTable({
  projectsWithRates,
  selectedMonth,
  onUpdateRate,
  onRatesChange,
}: BillingRatesTableProps) {
  // Modal state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectRateDisplay | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleEditClick = (project: ProjectRateDisplay) => {
    setSelectedProject(project);
    setIsEditorOpen(true);
  };

  const handleCloseEditor = () => {
    setIsEditorOpen(false);
    setSelectedProject(null);
  };

  const handleSaveRate = async (projectId: string, month: MonthSelection, rate: number) => {
    setIsSaving(true);
    try {
      const success = await onUpdateRate(projectId, month, rate);
      if (success) {
        onRatesChange();
      }
      return success;
    } finally {
      setIsSaving(false);
    }
  };

  // Sort projects by rate (highest first), then by name
  const sortedProjects = useMemo(() => {
    return [...projectsWithRates].sort((a, b) => {
      // Sort by rate descending
      const rateDiff = b.effectiveRate - a.effectiveRate;
      if (rateDiff !== 0) return rateDiff;
      // Then by name ascending
      return a.projectName.localeCompare(b.projectName);
    });
  }, [projectsWithRates]);

  // Define columns for AccordionFlat
  const columns: AccordionFlatColumn[] = [
    { key: 'project', label: 'Project', align: 'left' },
    { key: 'rate', label: 'Rate ($/hr)', align: 'right' },
  ];

  // Helper to build a row for a project
  const buildProjectRow = (project: ProjectRateDisplay): AccordionFlatRow => {
    const sourceDotColor = getSourceDotColor(project.source);
    const sourceLabel = getSourceLabel(project);

    // Actions dropdown
    const menuItems = [
      {
        label: 'Edit Rate',
        onClick: () => handleEditClick(project),
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        ),
      },
    ];

    // Project name with "not yet created" indicator if needed
    const projectNameContent = (
      <div className="flex items-center gap-2">
        <span className={project.existedInSelectedMonth ? 'text-vercel-gray-600' : 'text-vercel-gray-400'}>
          {project.projectName}
        </span>
        {!project.existedInSelectedMonth && (
          <span className="text-2xs text-vercel-gray-300 px-1.5 py-0.5 bg-vercel-gray-50 rounded">
            not yet created
          </span>
        )}
      </div>
    );

    // Rate cell with source indicator
    const rateContent = (
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${sourceDotColor}`}></span>
        <span className="text-sm text-vercel-gray-600">
          ${project.effectiveRate.toFixed(2)}
        </span>
        {sourceLabel && (
          <span className="text-2xs text-vercel-gray-400">
            ({sourceLabel})
          </span>
        )}
      </div>
    );

    return {
      id: project.projectId,
      cells: {
        project: projectNameContent,
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
    const groupMap = new Map<string, ProjectRateDisplay[]>();

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
        // Include invisible spacer to align with project row icons
        labelRight: (
          <div className="flex items-center">
            <div className="ml-4 w-6 shrink-0" />
          </div>
        ),
        rows: clientProjects.map(buildProjectRow),
      });
    }

    // Sort groups by average rate (highest first)
    return result.sort((a, b) => {
      const avgA = groupedByCompany.get(a.id)!.reduce(
        (sum, p) => sum + p.effectiveRate,
        0
      ) / groupedByCompany.get(a.id)!.length;
      const avgB = groupedByCompany.get(b.id)!.reduce(
        (sum, p) => sum + p.effectiveRate,
        0
      ) / groupedByCompany.get(b.id)!.length;
      return avgB - avgA;
    });
  }, [groupedByCompany]);

  return (
    <>
      <AccordionFlat
        alwaysExpanded={true}
        columns={columns}
        groups={groups}
      />

      {/* Editor Modal */}
      <RateEditModal
        isOpen={isEditorOpen}
        onClose={handleCloseEditor}
        project={selectedProject}
        initialMonth={selectedMonth}
        onSave={handleSaveRate}
        isSaving={isSaving}
      />
    </>
  );
}
