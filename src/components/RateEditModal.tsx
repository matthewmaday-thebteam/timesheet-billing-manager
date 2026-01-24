/**
 * RateEditModal - Edit project rate and rounding for the selected month
 *
 * Features:
 * - Rate input field
 * - Rounding increment select
 * - Current rate/rounding display with source
 * - Rate and rounding history toggles
 * - Save/Cancel buttons
 *
 * @category Component
 */

import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Spinner } from './Spinner';
import type { MonthSelection, ProjectRateDisplay, RoundingIncrement } from '../types';
import { useRateHistory, formatRateMonth } from '../hooks/useRateHistory';
import { useRoundingHistory, formatRoundingMonth, getRoundingLabel, getRoundingLabelFull } from '../hooks/useRoundingHistory';

interface RateEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectRateDisplay | null;
  initialMonth: MonthSelection;
  onSave: (projectId: string, month: MonthSelection, rate: number) => Promise<boolean>;
  onSaveRounding: (projectId: string, month: MonthSelection, increment: RoundingIncrement) => Promise<boolean>;
  isSaving: boolean;
}

const ROUNDING_OPTIONS: { value: RoundingIncrement; label: string }[] = [
  { value: 0, label: 'Actual (no rounding)' },
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
];

export function RateEditModal({
  isOpen,
  onClose,
  project,
  initialMonth,
  onSave,
  onSaveRounding,
  isSaving,
}: RateEditModalProps) {
  const [rateValue, setRateValue] = useState<string>('');
  const [roundingValue, setRoundingValue] = useState<RoundingIncrement>(15);
  const [showRateHistory, setShowRateHistory] = useState(false);
  const [showRoundingHistory, setShowRoundingHistory] = useState(false);
  const [lastResetKey, setLastResetKey] = useState<string>('');

  // Fetch rate history for the project
  const { history: rateHistory, isLoading: rateHistoryLoading } = useRateHistory(project?.projectId || null);

  // Fetch rounding history for the project
  const { history: roundingHistory, isLoading: roundingHistoryLoading } = useRoundingHistory(project?.projectId || null);

  // Reset form when project/isOpen changes
  const resetKey = `${project?.projectId ?? 'none'}-${isOpen}`;
  useEffect(() => {
    if (resetKey !== lastResetKey) {
      setLastResetKey(resetKey);
      setRateValue(project?.effectiveRate?.toString() || '');
      setRoundingValue(project?.effectiveRounding ?? 15);
      setShowRateHistory(false);
      setShowRoundingHistory(false);
    }
  }, [resetKey, lastResetKey, project?.effectiveRate, project?.effectiveRounding]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!project) return;

    const rate = parseFloat(rateValue);
    if (isNaN(rate) || rate < 0) {
      return;
    }

    // Check if rate changed
    const rateChanged = rate !== project.effectiveRate;
    // Check if rounding changed
    const roundingChanged = roundingValue !== project.effectiveRounding;

    let success = true;

    // Save rate if changed
    if (rateChanged) {
      success = await onSave(project.projectId, initialMonth, rate);
    }

    // Save rounding if changed
    if (success && roundingChanged) {
      success = await onSaveRounding(project.projectId, initialMonth, roundingValue);
    }

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
            onClick={() => setShowRateHistory(!showRateHistory)}
          >
            <svg
              className={`w-3 h-3 transition-transform ${showRateHistory ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {showRateHistory ? 'Hide rate history' : 'Show rate history'}
          </button>

          {showRateHistory && (
            <div className="mt-2 border border-vercel-gray-100 rounded-md overflow-hidden">
              {rateHistoryLoading ? (
                <div className="p-4 text-center">
                  <Spinner size="sm" />
                </div>
              ) : rateHistory.length === 0 ? (
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
                    {rateHistory.slice(0, 12).map((entry) => (
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

        {/* Divider */}
        <div className="border-t border-vercel-gray-100" />

        {/* Rounding Select */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Time Rounding
          </label>
          <select
            value={roundingValue}
            onChange={(e) => setRoundingValue(Number(e.target.value) as RoundingIncrement)}
            className="w-full px-3 py-2 bg-white border border-vercel-gray-100 rounded-md text-sm text-vercel-gray-600 focus:ring-1 focus:ring-black focus:border-vercel-gray-600 focus:outline-none transition-colors duration-200 ease-out"
          >
            {ROUNDING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-2xs text-vercel-gray-300">
            Current: {getRoundingLabelFull(project?.effectiveRounding ?? 15)} ({project?.roundingSource || 'default'})
          </p>
        </div>

        {/* Rounding History Toggle */}
        <div>
          <button
            type="button"
            className="text-xs text-vercel-gray-400 hover:text-vercel-gray-600 flex items-center gap-1"
            onClick={() => setShowRoundingHistory(!showRoundingHistory)}
          >
            <svg
              className={`w-3 h-3 transition-transform ${showRoundingHistory ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {showRoundingHistory ? 'Hide rounding history' : 'Show rounding history'}
          </button>

          {showRoundingHistory && (
            <div className="mt-2 border border-vercel-gray-100 rounded-md overflow-hidden">
              {roundingHistoryLoading ? (
                <div className="p-4 text-center">
                  <Spinner size="sm" />
                </div>
              ) : roundingHistory.length === 0 ? (
                <div className="p-4 text-xs text-vercel-gray-400 text-center">
                  No rounding history found
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-vercel-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-vercel-gray-400 font-medium">Month</th>
                      <th className="px-3 py-2 text-right text-vercel-gray-400 font-medium">Rounding</th>
                      <th className="px-3 py-2 text-right text-vercel-gray-400 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-vercel-gray-100">
                    {roundingHistory.slice(0, 12).map((entry) => (
                      <tr key={entry.roundingMonth} className="hover:bg-vercel-gray-50">
                        <td className="px-3 py-2 text-vercel-gray-600">
                          {formatRoundingMonth(entry.roundingMonth)}
                        </td>
                        <td className="px-3 py-2 text-right text-vercel-gray-600 font-medium">
                          {getRoundingLabel(entry.roundingIncrement)}
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
