import { useState, useMemo } from 'react';
import {
  getBillingRates,
  setProjectRate,
  calculateProjectRevenue,
  formatCurrency,
  getEffectiveRate,
  buildDbRateLookupByName,
} from '../utils/billing';
import { minutesToHours } from '../utils/calculations';
import { useProjects } from '../hooks/useProjects';
import { AccordionFlat } from './AccordionFlat';
import type { AccordionFlatColumn, AccordionFlatRow, AccordionFlatFooterCell } from './AccordionFlat';
import type { ProjectSummary } from '../types';

interface BillingRatesTableProps {
  projects: ProjectSummary[];
  onRatesChange: () => void;
}

export function BillingRatesTable({ projects, onRatesChange }: BillingRatesTableProps) {
  const [rates, setRates] = useState<Record<string, number>>(getBillingRates);
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  // Get database rates
  const { projects: dbProjects } = useProjects();
  const dbRateLookup = useMemo(() => buildDbRateLookupByName(dbProjects), [dbProjects]);

  const handleEditStart = (projectName: string) => {
    setEditingProject(projectName);
    setEditValue((rates[projectName] ?? 0).toString());
  };

  const handleEditSave = (projectName: string) => {
    const newRate = parseFloat(editValue) || 0;
    setProjectRate(projectName, newRate);
    setRates(prev => ({ ...prev, [projectName]: newRate }));
    setEditingProject(null);
    onRatesChange();
  };

  const handleEditCancel = () => {
    setEditingProject(null);
    setEditValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent, projectName: string) => {
    if (e.key === 'Enter') {
      handleEditSave(projectName);
    } else if (e.key === 'Escape') {
      handleEditCancel();
    }
  };

  // Sort projects by revenue (highest first)
  const sortedProjects = [...projects].sort((a, b) => {
    const revenueA = calculateProjectRevenue(a, rates, dbRateLookup);
    const revenueB = calculateProjectRevenue(b, rates, dbRateLookup);
    return revenueB - revenueA;
  });

  const totalRevenue = sortedProjects.reduce(
    (sum, p) => sum + calculateProjectRevenue(p, rates, dbRateLookup),
    0
  );

  // Define columns for AccordionFlat
  const columns: AccordionFlatColumn[] = [
    { key: 'project', label: 'Project', align: 'left' },
    { key: 'hours', label: 'Hours', align: 'right' },
    { key: 'rate', label: 'Rate ($/hr)', align: 'right' },
    { key: 'revenue', label: 'Revenue', align: 'right' },
  ];

  // Build rows with cell content
  const rows: AccordionFlatRow[] = sortedProjects.map((project) => {
    const effectiveRate = getEffectiveRate(project.projectName, dbRateLookup, rates);
    const hasDbRate = dbRateLookup.has(project.projectName);
    const revenue = calculateProjectRevenue(project, rates, dbRateLookup);
    const isEditing = editingProject === project.projectName;

    // Rate cell content (with editing functionality)
    let rateCell: React.ReactNode;
    if (isEditing && !hasDbRate) {
      rateCell = (
        <div className="flex items-center justify-end gap-1">
          <span className="text-vercel-gray-400">$</span>
          <input
            type="number"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, project.projectName)}
            onBlur={() => handleEditSave(project.projectName)}
            className="w-20 px-2 py-1 text-sm text-right border border-vercel-gray-600 rounded-md bg-white focus:ring-1 focus:ring-black focus:outline-none"
            step="0.01"
            min="0"
            autoFocus
          />
        </div>
      );
    } else if (hasDbRate) {
      rateCell = (
        <span className="px-2 py-1 text-sm text-vercel-gray-600" title="Rate set in Rates page">
          ${effectiveRate.toFixed(2)}
        </span>
      );
    } else {
      rateCell = (
        <button
          onClick={() => handleEditStart(project.projectName)}
          className={`px-2 py-1 text-sm rounded-md hover:bg-vercel-gray-50 border border-transparent hover:border-vercel-gray-100 transition-colors ${
            effectiveRate === 0 ? 'text-error' : 'text-vercel-gray-600'
          }`}
          title="Click to edit (legacy)"
        >
          ${effectiveRate.toFixed(2)}
        </button>
      );
    }

    return {
      id: project.projectName,
      cells: {
        project: <span className="text-vercel-gray-600">{project.projectName}</span>,
        hours: <span className="text-vercel-gray-400">{minutesToHours(project.totalMinutes)}</span>,
        rate: rateCell,
        revenue: (
          <span className={`font-medium ${revenue > 0 ? 'text-vercel-gray-600' : 'text-vercel-gray-300'}`}>
            {formatCurrency(revenue)}
          </span>
        ),
      },
    };
  });

  // Footer cells
  const footer: AccordionFlatFooterCell[] = [
    { columnKey: 'project', content: 'Total' },
    { columnKey: 'hours', content: minutesToHours(projects.reduce((sum, p) => sum + p.totalMinutes, 0)) },
    { columnKey: 'rate', content: null },
    { columnKey: 'revenue', content: formatCurrency(totalRevenue) },
  ];

  return (
    <AccordionFlat
      header={
        <>
          <h3 className="text-sm font-semibold text-vercel-gray-600">Billing Rates & Revenue</h3>
          <p className="text-xs font-mono text-vercel-gray-400">Click to edit hourly rates per project</p>
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
