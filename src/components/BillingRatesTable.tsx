import { useState, useMemo } from 'react';
import { AccordionFlat } from './AccordionFlat';
import { RateEditModal } from './RateEditModal';
import { DropdownMenu } from './DropdownMenu';
import { useCanonicalCompanyMapping } from '../hooks/useCanonicalCompanyMapping';
import type { AccordionFlatColumn, AccordionFlatRow, AccordionFlatGroup } from './AccordionFlat';
import type { ProjectRateDisplayWithBilling, MonthSelection, RoundingIncrement, ProjectBillingLimits } from '../types';

interface BillingRatesTableProps {
  projectsWithRates: ProjectRateDisplayWithBilling[];
  selectedMonth: MonthSelection;
  onUpdateRate: (projectId: string, month: MonthSelection, rate: number) => Promise<boolean>;
  onUpdateRounding: (projectId: string, month: MonthSelection, increment: RoundingIncrement) => Promise<boolean>;
  onUpdateBillingLimits: (projectId: string, month: MonthSelection, limits: Partial<ProjectBillingLimits>) => Promise<boolean>;
  onUpdateActiveStatus: (projectId: string, month: MonthSelection, isActive: boolean) => Promise<boolean>;
  onRatesChange: () => void;
}

export function BillingRatesTable({
  projectsWithRates,
  selectedMonth,
  onUpdateRate,
  onUpdateRounding,
  onUpdateBillingLimits,
  onUpdateActiveStatus,
  onRatesChange,
}: BillingRatesTableProps) {
  // Get canonical company mapping for grouping
  const { getCanonicalCompany } = useCanonicalCompanyMapping();

  // Modal state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectRateDisplayWithBilling | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleEditClick = (project: ProjectRateDisplayWithBilling) => {
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

  const handleSaveRounding = async (projectId: string, month: MonthSelection, increment: RoundingIncrement) => {
    setIsSaving(true);
    try {
      const success = await onUpdateRounding(projectId, month, increment);
      if (success) {
        onRatesChange();
      }
      return success;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveBillingLimits = async (projectId: string, month: MonthSelection, limits: Partial<ProjectBillingLimits>) => {
    setIsSaving(true);
    try {
      const success = await onUpdateBillingLimits(projectId, month, limits);
      if (success) {
        onRatesChange();
      }
      return success;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveActiveStatus = async (projectId: string, month: MonthSelection, isActive: boolean) => {
    setIsSaving(true);
    try {
      const success = await onUpdateActiveStatus(projectId, month, isActive);
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
    { key: 'minHr', label: 'Min Hr', align: 'right' },
    { key: 'maxHr', label: 'Max Hr', align: 'right' },
    { key: 'rollover', label: 'Rollover', align: 'center' },
    { key: 'rounding', label: 'Rounding', align: 'right' },
    { key: 'rate', label: 'Rate', align: 'right' },
  ];

  // Helper to build a row for a project
  const buildProjectRow = (project: ProjectRateDisplayWithBilling): AccordionFlatRow => {
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

    // Min Hr cell
    const minHrContent = (
      <span className="text-sm text-vercel-gray-600">
        {project.minimumHours !== null ? project.minimumHours : '—'}
      </span>
    );

    // Max Hr cell
    const maxHrContent = (
      <span className="text-sm text-vercel-gray-600">
        {project.maximumHours !== null ? project.maximumHours : '—'}
      </span>
    );

    // Rollover cell
    const rolloverContent = (
      <span className="text-sm text-vercel-gray-600">
        {project.carryoverEnabled ? 'Yes' : 'No'}
      </span>
    );

    // Rounding cell
    const roundingContent = (
      <span className={`text-sm ${project.effectiveRounding !== 15 ? 'text-bteam-brand' : 'text-vercel-gray-600'}`}>
        {project.effectiveRounding === 0 ? 'Actual' : `${project.effectiveRounding}m`}
      </span>
    );

    // Rate cell
    const rateContent = (
      <span className="text-sm text-vercel-gray-600">
        ${project.effectiveRate.toFixed(2)}
      </span>
    );

    return {
      id: project.projectId,
      cells: {
        project: projectNameContent,
        minHr: minHrContent,
        maxHr: maxHrContent,
        rollover: rolloverContent,
        rounding: roundingContent,
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

  // Group projects by company/client (using canonical company for grouping)
  const groupedByCompany = useMemo(() => {
    const groupMap = new Map<string, ProjectRateDisplayWithBilling[]>();

    for (const project of sortedProjects) {
      // Get canonical company name (uses primary company name if part of a group)
      const canonicalInfo = getCanonicalCompany(project.clientId);
      const clientName = canonicalInfo?.canonicalDisplayName || project.clientName || 'Unassigned';
      if (!groupMap.has(clientName)) {
        groupMap.set(clientName, []);
      }
      groupMap.get(clientName)!.push(project);
    }

    return groupMap;
  }, [sortedProjects, getCanonicalCompany]);

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
        onSaveRounding={handleSaveRounding}
        onSaveBillingLimits={handleSaveBillingLimits}
        onSaveActiveStatus={handleSaveActiveStatus}
        isSaving={isSaving}
      />
    </>
  );
}
