import { useState, useMemo, useEffect } from 'react';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { useTimeOff } from '../../hooks/useTimeOff';
import { useEmployeeTableEntities } from '../../hooks/useEmployeeTableEntities';
import { supabase } from '../../lib/supabase';
import { useDateFilter } from '../../contexts/DateFilterContext';
import { RangeSelector } from '../RangeSelector';
import { Card } from '../Card';
import { Spinner } from '../Spinner';
import { DailyHoursChart } from '../atoms/charts/DailyHoursChart';
import { BurnGrid } from '../atoms/BurnGrid';
import type { BulgarianHoliday } from '../../types';

export function BurnPage() {
  const { dateRange, mode, selectedMonth: filterSelectedMonth, setDateRange, setFilter } = useDateFilter();

  const { entries, userIdToDisplayNameLookup, loading, error } = useTimesheetData(dateRange);

  // Fetch time-off data for the selected period
  const { timeOff } = useTimeOff({
    startDate: dateRange.start,
    endDate: dateRange.end,
    approvedOnly: true,
  });

  // Fetch employee entities (excludes grouped members to avoid double-counting)
  const { entities: employees } = useEmployeeTableEntities();

  // Fetch holidays for the selected month
  const [holidays, setHolidays] = useState<BulgarianHoliday[]>([]);
  useEffect(() => {
    async function fetchHolidays() {
      const year = dateRange.start.getFullYear();
      const { data } = await supabase
        .from('bulgarian_holidays')
        .select('*')
        .eq('year', year);
      setHolidays(data || []);
    }
    fetchHolidays();
  }, [dateRange.start]);

  // Aggregate entries by employee and date for the BurnGrid
  const burnGridData = useMemo(() => {
    // Map: employee name -> (date -> total hours)
    const employeeMap = new Map<string, Map<string, number>>();

    for (const entry of entries) {
      // Get display name from lookup, fallback to user_name
      const userName = (entry.user_id && userIdToDisplayNameLookup.get(entry.user_id)) || entry.user_name;

      if (!employeeMap.has(userName)) {
        employeeMap.set(userName, new Map());
      }

      const dateMap = employeeMap.get(userName)!;
      const currentMinutes = dateMap.get(entry.work_date) || 0;
      dateMap.set(entry.work_date, currentMinutes + entry.total_minutes);
    }

    // Convert minutes to hours and sort employees alphabetically
    const result: Array<{ name: string; hoursByDate: Map<string, number> }> = [];

    const sortedNames = Array.from(employeeMap.keys()).sort((a, b) => a.localeCompare(b));

    for (const name of sortedNames) {
      const dateMinutes = employeeMap.get(name)!;
      const hoursByDate = new Map<string, number>();

      for (const [date, minutes] of dateMinutes) {
        hoursByDate.set(date, minutes / 60);
      }

      result.push({ name, hoursByDate });
    }

    return result;
  }, [entries, userIdToDisplayNameLookup]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Burn</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Resource utilization and daily hours breakdown
          </p>
        </div>
      </div>

      {/* Range Selector */}
      <RangeSelector
        variant="dateRange"
        dateRange={dateRange}
        onChange={setDateRange}
        controlledMode={mode}
        controlledSelectedMonth={filterSelectedMonth}
        onFilterChange={setFilter}
      />

      {/* Loading State */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading burn data...</span>
        </div>
      ) : error ? (
        <div className="p-4 bg-error-light border border-error rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-error">{error}</span>
          </div>
        </div>
      ) : (
        <>
          {/* Resource Utilization Chart */}
          <Card>
            <h2 className="text-base font-medium text-vercel-gray-600 mb-4">Resource Utilization</h2>
            <DailyHoursChart
              entries={entries}
              startDate={dateRange.start}
              endDate={dateRange.end}
              holidays={holidays}
              resources={employees}
              timeOff={timeOff}
            />
          </Card>

          {/* Daily Hours Grid - breaks out of container for full width */}
          <div
            className="relative w-screen px-6"
            style={{ marginLeft: 'calc(-50vw + 50%)', marginRight: 'calc(-50vw + 50%)' }}
          >
            <BurnGrid
              data={burnGridData}
              startDate={dateRange.start}
              endDate={dateRange.end}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default BurnPage;
