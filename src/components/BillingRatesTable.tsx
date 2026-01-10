import { useState, useEffect } from 'react';
import {
  getBillingRates,
  setProjectRate,
  calculateProjectRevenue,
  formatCurrency,
} from '../utils/billing';
import { minutesToHours } from '../utils/calculations';
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
    const revenueA = calculateProjectRevenue(a, rates);
    const revenueB = calculateProjectRevenue(b, rates);
    return revenueB - revenueA;
  });

  const totalRevenue = sortedProjects.reduce(
    (sum, p) => sum + calculateProjectRevenue(p, rates),
    0
  );

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <div>
            <h3 className="font-semibold text-gray-900">Billing Rates & Revenue</h3>
            <p className="text-sm text-gray-500">Click to edit hourly rates per project</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-green-600">{formatCurrency(totalRevenue)}</div>
          <div className="text-xs text-gray-500">total revenue</div>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-100">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Project
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Hours
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Rate ($/hr)
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Revenue
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedProjects.map((project) => {
                const rate = rates[project.projectName] ?? 0;
                const revenue = calculateProjectRevenue(project, rates);
                const isEditing = editingProject === project.projectName;

                return (
                  <tr key={project.projectName} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {project.projectName}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 text-right">
                      {minutesToHours(project.totalMinutes)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-gray-400">$</span>
                          <input
                            type="number"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, project.projectName)}
                            onBlur={() => handleEditSave(project.projectName)}
                            className="w-20 px-2 py-1 text-sm text-right border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            step="0.01"
                            min="0"
                            autoFocus
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => handleEditStart(project.projectName)}
                          className={`px-2 py-1 text-sm rounded hover:bg-gray-100 transition-colors ${
                            rate === 0 ? 'text-red-500' : 'text-gray-700'
                          }`}
                          title="Click to edit"
                        >
                          {rate === 0 ? 'Set rate' : `$${rate.toFixed(2)}`}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-right">
                      <span className={revenue > 0 ? 'text-green-600' : 'text-gray-400'}>
                        {formatCurrency(revenue)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50">
              <tr>
                <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                  Total
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right">
                  {minutesToHours(projects.reduce((sum, p) => sum + p.totalMinutes, 0))}
                </td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3 text-sm font-bold text-green-600 text-right">
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
