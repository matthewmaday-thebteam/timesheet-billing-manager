import { useState, useMemo } from 'react';
import { useHolidays } from '../../hooks/useHolidays';
import { HolidayCalendar } from '../HolidayCalendar';
import { HolidayTable } from '../HolidayTable';
import { HolidayEditorModal } from '../HolidayEditorModal';
import { MetricCard } from '../MetricCard';
import { Modal } from '../Modal';
import { Select } from '../Select';
import { Button } from '../Button';
import { Spinner } from '../Spinner';
import type { BulgarianHoliday } from '../../types';

export function HolidaysPage() {
  const {
    holidays,
    loading,
    error,
    selectedYear,
    setSelectedYear,
    addHoliday,
    updateHoliday,
    deleteHoliday,
    syncYear,
    isOperating,
  } = useHolidays();

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedHoliday, setSelectedHoliday] = useState<BulgarianHoliday | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [holidayToDelete, setHolidayToDelete] = useState<BulgarianHoliday | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(() => [
    { value: String(currentYear - 1), label: String(currentYear - 1) },
    { value: String(currentYear), label: String(currentYear) },
    { value: String(currentYear + 1), label: String(currentYear + 1) },
    { value: String(currentYear + 2), label: String(currentYear + 2) },
  ], [currentYear]);

  const handleAddClick = () => {
    setSelectedHoliday(null);
    setIsEditorOpen(true);
  };

  const handleEditClick = (holiday: BulgarianHoliday) => {
    setSelectedHoliday(holiday);
    setIsEditorOpen(true);
  };

  const handleDeleteClick = (holiday: BulgarianHoliday) => {
    setHolidayToDelete(holiday);
    setIsDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!holidayToDelete) return;
    await deleteHoliday(holidayToDelete.id);
    setIsDeleteConfirmOpen(false);
    setHolidayToDelete(null);
  };

  const handleCalendarDateClick = (_date: Date, holiday?: BulgarianHoliday) => {
    if (holiday) {
      handleEditClick(holiday);
    }
  };

  const handleSyncYear = async () => {
    setSyncMessage(null);
    const result = await syncYear(selectedYear);
    if (result.success) {
      if (result.added > 0) {
        setSyncMessage(`Added ${result.added} new holiday${result.added > 1 ? 's' : ''}`);
      } else {
        setSyncMessage('All holidays already exist for this year');
      }
    }
    // Clear message after 3 seconds
    setTimeout(() => setSyncMessage(null), 3000);
  };

  const handleCloseEditor = () => {
    setIsEditorOpen(false);
    setSelectedHoliday(null);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Bulgarian Holidays</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Manage public holidays excluded from working day calculations
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Year Selector */}
          <Select
            value={String(selectedYear)}
            onChange={(value) => setSelectedYear(Number(value))}
            options={yearOptions}
            className="w-24"
          />

          {/* Sync Year Button */}
          <Button
            variant="secondary"
            onClick={handleSyncYear}
            disabled={isOperating}
          >
            {isOperating ? (
              <span className="flex items-center gap-2">
                <Spinner size="sm" />
                Syncing...
              </span>
            ) : (
              `Sync ${selectedYear}`
            )}
          </Button>

          {/* Add Holiday Button */}
          <Button variant="primary" onClick={handleAddClick}>
            Add Holiday
          </Button>
        </div>
      </div>

      {/* Sync Message */}
      {syncMessage && (
        <div className="p-3 bg-success-light border border-success rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm text-success">{syncMessage}</span>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="p-4 bg-error-light border border-error rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-error">{error}</span>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard title="Total Holidays" value={holidays.length} />
        <MetricCard
          title="Auto-Generated"
          value={holidays.filter((h) => h.is_system_generated).length}
        />
        <MetricCard
          title="Manual"
          value={holidays.filter((h) => !h.is_system_generated).length}
        />
        <MetricCard title="Year" value={selectedYear} />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar */}
        <div className="lg:col-span-1">
          <HolidayCalendar
            holidays={holidays}
            year={selectedYear}
            onDateClick={handleCalendarDateClick}
          />
        </div>

        {/* Table */}
        <div className="lg:col-span-2">
          <HolidayTable
            holidays={holidays}
            loading={loading}
            onEdit={handleEditClick}
            onDelete={handleDeleteClick}
          />
        </div>
      </div>

      {/* Editor Modal */}
      <HolidayEditorModal
        isOpen={isEditorOpen}
        onClose={handleCloseEditor}
        holiday={selectedHoliday}
        onSave={addHoliday}
        onUpdate={updateHoliday}
        isSaving={isOperating}
        defaultYear={selectedYear}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        title="Delete Holiday"
        maxWidth="sm"
        centerTitle
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleConfirmDelete} disabled={isOperating}>
              {isOperating ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        <div className="text-center py-4">
          <svg className="mx-auto h-12 w-12 text-error mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-vercel-gray-600">
            Are you sure you want to delete{' '}
            <span className="font-semibold">{holidayToDelete?.holiday_name}</span>?
          </p>
          <p className="text-xs text-vercel-gray-400 mt-2">This action cannot be undone.</p>
        </div>
      </Modal>
    </div>
  );
}
