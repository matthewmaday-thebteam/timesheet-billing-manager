/**
 * DailyHoursChart - Official Design System Atom
 *
 * Displays resource utilization per day of the selected month.
 * Shows bars for actual hours with a horizontal line for expected hours.
 *
 * Expected hours calculation:
 * - Full-time employees: 8 hours per working day
 * - Part-time employees: 4 hours per working day
 * - Contractors/Vendors: excluded (0 hours)
 * - Weekends: 0 hours
 * - Holidays: 0 hours
 *
 * @official 2026-01-25
 * @category Atom
 *
 * Token Usage:
 * - Font: font-mono for axes, tooltips
 * - Colors: bteam-brand for actual hours, vercel-gray-400 at 50% for expected line
 */

import { useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { CHART_HEIGHT } from '../../../config/chartConfig';
import {
  axisTickStyle,
  axisLineStyle,
  tooltipStyle,
  chartColors,
  chartFontFamily,
} from './chartTheme';
import type { TimesheetEntry, BulgarianHoliday, Resource, EmployeeTimeOff } from '../../../types';

/** Hours per day by employment type */
const FULL_TIME_HOURS = 8;
const PART_TIME_HOURS = 4;

export interface DailyHoursChartProps {
  /** Timesheet entries to aggregate */
  entries: TimesheetEntry[];
  /** Start date of the selected period */
  startDate: Date;
  /** End date of the selected period */
  endDate: Date;
  /** Holidays for the selected period */
  holidays?: BulgarianHoliday[];
  /** Resources/employees for expected hours calculation */
  resources?: Resource[];
  /** Employee time-off records for reducing expected hours */
  timeOff?: EmployeeTimeOff[];
  /** Chart height in pixels */
  height?: number;
}

interface DailyDataPoint {
  day: string;
  dayNum: number;
  hours: number;
  expected: number;
}

/**
 * Format a Date to YYYY-MM-DD string in local timezone
 */
function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Chart margin configuration
const chartMargin = { top: 5, right: 30, left: 20, bottom: 5 };

/**
 * Check if a date is a weekend (Saturday or Sunday)
 */
function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Check if a date is a holiday
 */
function isHoliday(dateStr: string, holidayDates: Set<string>): boolean {
  return holidayDates.has(dateStr);
}

/**
 * Calculate expected hours per working day based on employee headcount.
 * - Full-time: 8 hours
 * - Part-time: 4 hours
 * - Contractors/Vendors: excluded
 */
function calculateExpectedHoursPerDay(resources: Resource[]): number {
  let totalExpected = 0;

  for (const resource of resources) {
    const typeName = resource.employment_type?.name?.toLowerCase() || '';

    // Exclude contractors and vendors
    if (typeName === 'contractor' || typeName === 'vendor') {
      continue;
    }

    // Part-time: 4 hours, Full-time: 8 hours
    if (typeName === 'part-time') {
      totalExpected += PART_TIME_HOURS;
    } else if (typeName === 'full-time') {
      totalExpected += FULL_TIME_HOURS;
    }
  }

  return totalExpected;
}

export function DailyHoursChart({
  entries,
  startDate,
  endDate,
  holidays = [],
  resources = [],
  timeOff = [],
  height = CHART_HEIGHT,
}: DailyHoursChartProps) {
  // Calculate expected hours per working day based on employee headcount
  const expectedPerDay = useMemo(
    () => calculateExpectedHoursPerDay(resources),
    [resources]
  );

  // Build a map of resource_id -> expected hours per day
  const resourceExpectedHours = useMemo(() => {
    const map = new Map<string, number>();
    for (const resource of resources) {
      const typeName = resource.employment_type?.name?.toLowerCase() || '';
      if (typeName === 'contractor' || typeName === 'vendor') continue;
      if (typeName === 'part-time') {
        map.set(resource.id, PART_TIME_HOURS);
      } else if (typeName === 'full-time') {
        map.set(resource.id, FULL_TIME_HOURS);
      }
    }
    return map;
  }, [resources]);

  // Build a map of date -> hours off due to time-off
  const timeOffByDate = useMemo(() => {
    const map = new Map<string, number>();

    for (const to of timeOff) {
      // Only count if we have a linked resource
      if (!to.resource_id) continue;

      const resourceHours = resourceExpectedHours.get(to.resource_id);
      if (!resourceHours) continue; // Not a tracked employee type

      // Iterate through each day of the time-off period
      const toStart = new Date(to.start_date);
      const toEnd = new Date(to.end_date);
      const current = new Date(toStart);

      while (current <= toEnd) {
        const dateStr = formatDateLocal(current);
        const existing = map.get(dateStr) || 0;
        map.set(dateStr, existing + resourceHours);
        current.setDate(current.getDate() + 1);
      }
    }

    return map;
  }, [timeOff, resourceExpectedHours]);

  // Transform entries into daily totals with expected hours
  const dailyData = useMemo(() => {
    // Build a map of date -> total minutes
    const dateMinutes = new Map<string, number>();

    for (const entry of entries) {
      const dateStr = entry.work_date;
      const current = dateMinutes.get(dateStr) || 0;
      dateMinutes.set(dateStr, current + entry.total_minutes);
    }

    // Build a set of holiday dates for fast lookup (normalize format)
    const holidayDates = new Set(
      holidays.map(h => {
        // Ensure consistent YYYY-MM-DD format
        const d = new Date(h.holiday_date);
        return formatDateLocal(d);
      })
    );

    // Generate all days in the range
    const data: DailyDataPoint[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      const dateStr = formatDateLocal(current);
      const dayNum = current.getDate();
      const minutes = dateMinutes.get(dateStr) || 0;

      // Expected hours: 0 for weekends and holidays, calculated from headcount for working days
      const isWorkingDay = !isWeekend(current) && !isHoliday(dateStr, holidayDates);

      // Start with base expected, then subtract time-off hours
      let expected = isWorkingDay ? expectedPerDay : 0;
      if (isWorkingDay) {
        const hoursOff = timeOffByDate.get(dateStr) || 0;
        expected = Math.max(0, expected - hoursOff);
      }

      data.push({
        day: String(dayNum),
        dayNum,
        hours: minutes / 60,
        expected,
      });

      current.setDate(current.getDate() + 1);
    }

    return data;
  }, [entries, startDate, endDate, holidays, expectedPerDay, timeOffByDate]);

  // Custom tooltip formatter
  const tooltipFormatter = (value: number | undefined, name: string | undefined) => {
    const label = name === 'hours' ? 'Actual' : 'Expected';
    return [`${(value ?? 0).toFixed(1)}h`, label];
  };

  // Calculate max hours for Y axis domain
  const maxHours = Math.max(...dailyData.map(d => Math.max(d.hours, d.expected)), 8);
  const yAxisMax = Math.ceil(maxHours / 4) * 4; // Round up to nearest 4

  return (
    <div
      className="w-full"
      role="img"
      aria-label={`Chart showing resource utilization per day compared to expected`}
    >
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={dailyData} margin={chartMargin}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={chartColors.gridLine}
            vertical={false}
          />
          <XAxis
            dataKey="day"
            tick={axisTickStyle}
            axisLine={axisLineStyle}
            tickLine={axisLineStyle}
            interval={0}
            fontSize={10}
          />
          <YAxis
            tick={axisTickStyle}
            axisLine={axisLineStyle}
            tickLine={axisLineStyle}
            tickFormatter={(value) => `${value}h`}
            domain={[0, yAxisMax]}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={tooltipFormatter}
            labelFormatter={(label) => `Day ${label}`}
            labelStyle={{ fontFamily: chartFontFamily }}
          />
          <Legend
            wrapperStyle={{ fontFamily: chartFontFamily, fontSize: 12 }}
            formatter={(value) => value === 'hours' ? 'Actual' : 'Expected'}
          />
          {/* Actual hours bars */}
          <Bar
            dataKey="hours"
            fill={chartColors.bteamBrand}
            radius={[2, 2, 0, 0]}
          />
          {/* Expected hours line - horizontal line over the bars */}
          <Line
            type="stepAfter"
            dataKey="expected"
            stroke={chartColors.axisText}
            strokeWidth={2}
            strokeOpacity={0.5}
            dot={false}
            activeDot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default DailyHoursChart;
