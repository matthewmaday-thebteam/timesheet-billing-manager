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
    <div className="bg-[#FFFFFF] rounded-lg border border-[#EAEAEA] overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-6 text-left hover:bg-[#FAFAFA] transition-colors focus:ring-1 focus:ring-black focus:outline-none"
      >
        <div className="flex items-center gap-3">
          <svg
            className={`w-4 h-4 text-[#666666] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <div>
            <h3 className="text-sm font-semibold text-[#000000]">Billing Rates & Revenue</h3>
            <p className="text-[12px] text-[#666666]">Click to edit hourly rates per project</p>
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#50E3C2]" />
            <span className="text-lg font-semibold text-[#000000]">{formatCurrency(totalRevenue)}</span>
          </div>
          <div className="text-[12px] text-[#666666]">total revenue</div>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-[#EAEAEA]">
          <table className="w-full">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <th className="px-6 py-3 text-left text-[12px] font-medium text-[#666666] uppercase tracking-wider">
                  Project
                </th>
                <th className="px-6 py-3 text-right text-[12px] font-medium text-[#666666] uppercase tracking-wider">
                  Hours
                </th>
                <th className="px-6 py-3 text-right text-[12px] font-medium text-[#666666] uppercase tracking-wider">
                  Rate ($/hr)
                </th>
                <th className="px-6 py-3 text-right text-[12px] font-medium text-[#666666] uppercase tracking-wider">
                  Revenue
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAEAEA]">
              {sortedProjects.map((project) => {
                const rate = rates[project.projectName] ?? 0;
                const revenue = calculateProjectRevenue(project, rates);
                const isEditing = editingProject === project.projectName;

                return (
                  <tr key={project.projectName} className="hover:bg-[#FAFAFA] transition-colors">
                    <td className="px-6 py-4 text-sm text-[#000000]">
                      {project.projectName}
                    </td>
                    <td className="px-6 py-4 text-sm text-[#666666] text-right">
                      {minutesToHours(project.totalMinutes)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-[#666666]">$</span>
                          <input
                            type="number"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, project.projectName)}
                            onBlur={() => handleEditSave(project.projectName)}
                            className="w-20 px-2 py-1 text-sm text-right border border-[#000000] rounded-md bg-[#FFFFFF] focus:ring-1 focus:ring-black focus:outline-none"
                            step="0.01"
                            min="0"
                            autoFocus
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => handleEditStart(project.projectName)}
                          className={`px-2 py-1 text-sm rounded-md hover:bg-[#FAFAFA] border border-transparent hover:border-[#EAEAEA] transition-colors ${
                            rate === 0 ? 'text-[#EE0000]' : 'text-[#000000]'
                          }`}
                          title="Click to edit"
                        >
                          {rate === 0 ? 'Set rate' : `$${rate.toFixed(2)}`}
                        </button>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-right">
                      <span className={revenue > 0 ? 'text-[#000000]' : 'text-[#888888]'}>
                        {formatCurrency(revenue)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-[#FAFAFA]">
              <tr>
                <td className="px-6 py-4 text-sm font-semibold text-[#000000]">
                  Total
                </td>
                <td className="px-6 py-4 text-sm font-semibold text-[#000000] text-right">
                  {minutesToHours(projects.reduce((sum, p) => sum + p.totalMinutes, 0))}
                </td>
                <td className="px-6 py-4"></td>
                <td className="px-6 py-4 text-sm font-semibold text-[#000000] text-right">
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
