import { useState, useEffect, useMemo } from 'react';
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
import type { ProjectSummary } from '../types';

interface BillingRatesTableProps {
  projects: ProjectSummary[];
  onRatesChange: () => void;
}

export function BillingRatesTable({ projects, onRatesChange }: BillingRatesTableProps) {
  const [rates, setRates] = useState<Record<string, number>>({});
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [isExpanded, setIsExpanded] = useState(false);

  // Get database rates
  const { projects: dbProjects } = useProjects();
  const dbRateLookup = useMemo(() => buildDbRateLookupByName(dbProjects), [dbProjects]);

  useEffect(() => {
    setRates(getBillingRates());
  }, []);

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

  return (
    <div className="bg-white rounded-lg border border-vercel-gray-100 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-6 text-left hover:bg-vercel-gray-50 transition-colors focus:ring-1 focus:ring-black focus:outline-none"
      >
        <div className="flex items-center gap-3">
          <svg
            className={`w-4 h-4 text-vercel-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <div>
            <h3 className="text-sm font-semibold text-vercel-gray-600">Billing Rates & Revenue</h3>
            <p className="text-xs text-vercel-gray-400">Click to edit hourly rates per project</p>
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-success" />
            <span className="text-lg font-semibold text-vercel-gray-600">{formatCurrency(totalRevenue)}</span>
          </div>
          <div className="text-xs text-vercel-gray-400">total revenue</div>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-vercel-gray-100">
          <table className="w-full">
            <thead className="bg-vercel-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                  Project
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                  Hours
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                  Rate ($/hr)
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                  Revenue
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vercel-gray-100">
              {sortedProjects.map((project) => {
                const effectiveRate = getEffectiveRate(project.projectName, dbRateLookup, rates);
                const hasDbRate = dbRateLookup.has(project.projectName);
                const revenue = calculateProjectRevenue(project, rates, dbRateLookup);
                const isEditing = editingProject === project.projectName;

                return (
                  <tr key={project.projectName} className="hover:bg-vercel-gray-50 transition-colors">
                    <td className="px-6 py-4 text-sm text-vercel-gray-600">
                      {project.projectName}
                    </td>
                    <td className="px-6 py-4 text-sm text-vercel-gray-400 text-right">
                      {minutesToHours(project.totalMinutes)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {isEditing && !hasDbRate ? (
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
                      ) : hasDbRate ? (
                        <span className="px-2 py-1 text-sm text-vercel-gray-600" title="Rate set in Rates page">
                          ${effectiveRate.toFixed(2)}
                        </span>
                      ) : (
                        <button
                          onClick={() => handleEditStart(project.projectName)}
                          className={`px-2 py-1 text-sm rounded-md hover:bg-vercel-gray-50 border border-transparent hover:border-vercel-gray-100 transition-colors ${
                            effectiveRate === 0 ? 'text-error' : 'text-vercel-gray-600'
                          }`}
                          title="Click to edit (legacy)"
                        >
                          ${effectiveRate.toFixed(2)}
                        </button>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-right">
                      <span className={revenue > 0 ? 'text-vercel-gray-600' : 'text-vercel-gray-300'}>
                        {formatCurrency(revenue)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-vercel-gray-50">
              <tr>
                <td className="px-6 py-4 text-sm font-semibold text-vercel-gray-600">
                  Total
                </td>
                <td className="px-6 py-4 text-sm font-semibold text-vercel-gray-600 text-right">
                  {minutesToHours(projects.reduce((sum, p) => sum + p.totalMinutes, 0))}
                </td>
                <td className="px-6 py-4"></td>
                <td className="px-6 py-4 text-sm font-semibold text-vercel-gray-600 text-right">
                  {formatCurrency(totalRevenue)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
