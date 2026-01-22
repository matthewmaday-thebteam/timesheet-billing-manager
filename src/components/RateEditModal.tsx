/**
 * RateEditModal - Edit project rate for the selected month
 *
 * Features:
 * - Rate input field
 * - Current rate display with source
 * - Rate history toggle
 * - Save/Cancel buttons
 *
 * @category Component
 */

import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Spinner } from './Spinner';
import type { MonthSelection, ProjectRateDisplay } from '../types';
import { useRateHistory, formatRateMonth } from '../hooks/useRateHistory';

interface RateEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectRateDisplay | null;
  initialMonth: MonthSelection;
  onSave: (projectId: string, month: MonthSelection, rate: number) => Promise<boolean>;
  isSaving: boolean;
}

export function RateEditModal({
  isOpen,
  onClose,
  project,
  initialMonth,
  onSave,
  isSaving,
}: RateEditModalProps) {
  const [rateValue, setRateValue] = useState<string>('');
  const [showHistory, setShowHistory] = useState(false);
  const [lastResetKey, setLastResetKey] = useState<string>('');

  // Fetch rate history for the project
  const { history, isLoading: historyLoading } = useRateHistory(project?.projectId || null);

  // Reset form when project/isOpen changes
  const resetKey = `${project?.projectId ?? 'none'}-${isOpen}`;
  useEffect(() => {
    if (resetKey !== lastResetKey) {
      setLastResetKey(resetKey);
      setRateValue(project?.effectiveRate?.toString() || '');
      setShowHistory(false);
    }
  }, [resetKey, lastResetKey, project?.effectiveRate]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!project) return;

    const rate = parseFloat(rateValue);
    if (isNaN(rate) || rate < 0) {
      return;
    }

    const success = await onSave(project.projectId, initialMonth, rate);
    if (success) {
      onClose();
    }
  };

  const handleRateChange = (value: string) => {
    // Allow empty string, numbers, and decimal
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setRateValue(value);
    }
  };

  if (!project) return null;

  const footerContent = (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button
        variant="primary"
        onClick={() => handleSubmit()}
        disabled={isSaving || rateValue === ''}
      >
        {isSaving ? (
          <span className="flex items-center gap-2">
            <Spinner size="sm" />
            Saving...
          </span>
        ) : (
          'Save Rate'
        )}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Rate"
      maxWidth="sm"
      footer={footerContent}
    >
      <div className="space-y-6">
        {/* Project Name */}
        <div className="text-sm font-medium text-vercel-gray-600">
          {project.projectName}
        </div>

        {/* Rate Input */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Hourly Rate (USD)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-vercel-gray-400">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={rateValue}
              onChange={(e) => handleRateChange(e.target.value)}
              className="w-full pl-7 pr-3 py-2 bg-white border border-vercel-gray-100 rounded-md text-sm text-vercel-gray-600 placeholder-vercel-gray-300 focus:ring-1 focus:ring-black focus:border-vercel-gray-600 focus:outline-none transition-colors duration-200 ease-out"
              placeholder="45.00"
            />
          </div>
          <p className="mt-2 text-2xs text-vercel-gray-300">
            Enter 0 for unbillable projects.
          </p>
        </div>

        {/* Rate History Toggle */}
        <div>
          <button
            type="button"
            className="text-xs text-vercel-gray-400 hover:text-vercel-gray-600 flex items-center gap-1"
            onClick={() => setShowHistory(!showHistory)}
          >
            <svg
              className={`w-3 h-3 transition-transform ${showHistory ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {showHistory ? 'Hide rate history' : 'Show rate history'}
          </button>

          {showHistory && (
            <div className="mt-2 border border-vercel-gray-100 rounded-md overflow-hidden">
              {historyLoading ? (
                <div className="p-4 text-center">
                  <Spinner size="sm" />
                </div>
              ) : history.length === 0 ? (
                <div className="p-4 text-xs text-vercel-gray-400 text-center">
                  No rate history found
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-vercel-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-vercel-gray-400 font-medium">Month</th>
                      <th className="px-3 py-2 text-right text-vercel-gray-400 font-medium">Rate</th>
                      <th className="px-3 py-2 text-right text-vercel-gray-400 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-vercel-gray-100">
                    {history.slice(0, 12).map((entry) => (
                      <tr key={entry.rateMonth} className="hover:bg-vercel-gray-50">
                        <td className="px-3 py-2 text-vercel-gray-600">
                          {formatRateMonth(entry.rateMonth)}
                        </td>
                        <td className="px-3 py-2 text-right text-vercel-gray-600 font-medium">
                          ${entry.rate.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right text-vercel-gray-400">
                          {new Date(entry.updatedAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default RateEditModal;
