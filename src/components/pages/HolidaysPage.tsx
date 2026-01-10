import { useState } from 'react';
import { useHolidays } from '../../hooks/useHolidays';
import { HolidayCalendar } from '../HolidayCalendar';
import { HolidayTable } from '../HolidayTable';
import { HolidayEditorModal } from '../HolidayEditorModal';
import { Modal } from '../Modal';
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
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

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
          <h1 className="text-xl font-semibold text-[#000000]">Bulgarian Holidays</h1>
          <p className="text-sm text-[#666666] mt-1">
            Manage public holidays excluded from working day calculations
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Year Selector */}
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3 py-2 bg-[#FFFFFF] border border-[#EAEAEA] rounded-md text-sm text-[#000000] focus:ring-1 focus:ring-black focus:border-[#000000] focus:outline-none"
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>

          {/* Sync Year Button */}
          <button
            onClick={handleSyncYear}
            disabled={isOperating}
            className="px-4 py-2 text-sm font-medium text-[#666666] bg-[#FFFFFF] border border-[#EAEAEA] rounded-md hover:bg-[#FAFAFA] disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-1 focus:ring-black"
          >
            {isOperating ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Syncing...
              </span>
            ) : (
              `Sync ${selectedYear}`
            )}
          </button>

          {/* Add Holiday Button */}
          <button
            onClick={handleAddClick}
            className="px-4 py-2 text-sm font-medium text-[#FFFFFF] bg-[#000000] border border-[#000000] rounded-md hover:bg-[#333333] transition-colors focus:outline-none focus:ring-1 focus:ring-black"
          >
            Add Holiday
          </button>
        </div>
      </div>

      {/* Sync Message */}
      {syncMessage && (
        <div className="p-3 bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-[#166534]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm text-[#166534]">{syncMessage}</span>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="p-4 bg-[#FEF2F2] border border-[#FECACA] rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-[#DC2626]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-[#DC2626]">{error}</span>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-[#FFFFFF] rounded-lg border border-[#EAEAEA]">
          <p className="text-[12px] text-[#666666] mb-1">Total Holidays</p>
          <p className="text-2xl font-semibold text-[#000000]">{holidays.length}</p>
        </div>
        <div className="p-4 bg-[#FFFFFF] rounded-lg border border-[#EAEAEA]">
          <p className="text-[12px] text-[#666666] mb-1">Auto-Generated</p>
          <p className="text-2xl font-semibold text-[#000000]">
            {holidays.filter((h) => h.is_system_generated).length}
          </p>
        </div>
        <div className="p-4 bg-[#FFFFFF] rounded-lg border border-[#EAEAEA]">
          <p className="text-[12px] text-[#666666] mb-1">Manual</p>
          <p className="text-2xl font-semibold text-[#000000]">
            {holidays.filter((h) => !h.is_system_generated).length}
          </p>
        </div>
        <div className="p-4 bg-[#FFFFFF] rounded-lg border border-[#EAEAEA]">
          <p className="text-[12px] text-[#666666] mb-1">Year</p>
          <p className="text-2xl font-semibold text-[#000000]">{selectedYear}</p>
        </div>
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
            <button
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="px-4 py-2 text-sm font-medium text-[#666666] bg-[#FFFFFF] border border-[#EAEAEA] rounded-md hover:bg-[#FAFAFA] transition-colors focus:outline-none focus:ring-1 focus:ring-black"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmDelete}
              disabled={isOperating}
              className="px-4 py-2 text-sm font-medium text-[#FFFFFF] bg-[#EE0000] border border-[#EE0000] rounded-md hover:bg-[#CC0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-1 focus:ring-[#EE0000]"
            >
              {isOperating ? 'Deleting...' : 'Delete'}
            </button>
          </>
        }
      >
        <div className="text-center py-4">
          <svg className="mx-auto h-12 w-12 text-[#EE0000] mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-[#000000]">
            Are you sure you want to delete{' '}
            <span className="font-semibold">{holidayToDelete?.holiday_name}</span>?
          </p>
          <p className="text-[12px] text-[#666666] mt-2">This action cannot be undone.</p>
        </div>
      </Modal>
    </div>
  );
}
