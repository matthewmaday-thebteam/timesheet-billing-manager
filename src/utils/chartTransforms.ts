/**
 * Chart Data Transformers
 *
 * Utility functions to transform application data into chart-ready formats.
 *
 * @official 2026-01-11
 * @category Utils
 */

import type { ResourceSummary } from '../types';
import type { PieChartDataPoint, LineGraphDataPoint, MonthlyAggregate } from '../types/charts';
import { TARGET_RATIO, ANNUAL_BUDGET, TOP_N_RESOURCES } from '../config/chartConfig';

/**
 * Transform resource summaries into pie chart data.
 * Shows top N resources by hours, groups remainder into "Other".
 *
 * @param resources - Array of resource summaries from useTimesheetData
 * @param topN - Maximum number of segments (default: 5)
 * @returns Array of pie chart data points
 */
export function transformResourcesToPieData(
  resources: ResourceSummary[],
  topN: number = TOP_N_RESOURCES
): PieChartDataPoint[] {
  if (resources.length === 0) {
    return [];
  }

  // Convert to pie data format with hours
  const pieData: PieChartDataPoint[] = resources.map((resource) => ({
    name: resource.displayName || resource.userName,
    value: resource.totalMinutes / 60, // Convert minutes to hours
  }));

  // Sort by value descending
  pieData.sort((a, b) => b.value - a.value);

  // If within limit, return as-is
  if (pieData.length <= topN) {
    return pieData;
  }

  // Group into top N + "Other"
  const topSegments = pieData.slice(0, topN - 1);
  const otherSegments = pieData.slice(topN - 1);
  const otherValue = otherSegments.reduce((sum, item) => sum + item.value, 0);

  return [
    ...topSegments,
    { name: 'Other', value: otherValue, color: 'other' },
  ];
}

/**
 * Transform monthly aggregates into line chart data.
 * Shows cumulative values for the full year (Jan-Dec):
 * - Target: $150k/month compounding to annual target (budget * ratio) by December
 * - Budget: ~$83.3k/month compounding to annual budget by December
 * - Revenue: Cumulative earned revenue (persists once earned)
 *
 * @param monthlyAggregates - Array of monthly aggregate data
 * @param annualBudget - Annual budget in dollars (default: $1M)
 * @param targetRatio - Target multiplier (default: 1.8x)
 * @returns Array of 12 line graph data points (full year)
 */
export function transformToLineChartData(
  monthlyAggregates: MonthlyAggregate[],
  annualBudget: number = ANNUAL_BUDGET,
  targetRatio: number = TARGET_RATIO
): LineGraphDataPoint[] {
  const annualTarget = annualBudget * targetRatio;
  const monthlyTarget = annualTarget / 12;  // $150k/month for $1.8M annual
  const monthlyBudget = annualBudget / 12;  // ~$83.3k/month for $1M annual
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Build a map of month index (0-11) to monthly revenue
  const revenueByMonth = new Map<number, number>();
  for (const aggregate of monthlyAggregates) {
    const monthIndex = parseInt(aggregate.month.split('-')[1]) - 1;
    revenueByMonth.set(monthIndex, aggregate.totalRevenue);
  }

  // Find the last month with revenue data
  let lastMonthWithData = -1;
  for (let i = 0; i < 12; i++) {
    if (revenueByMonth.has(i)) {
      lastMonthWithData = i;
    }
  }

  // Generate cumulative values for full year
  let cumulativeRevenue = 0;

  return months.map((monthName, index) => {
    // Cumulative target and budget (compounds each month)
    const cumulativeTarget = monthlyTarget * (index + 1);
    const cumulativeBudget = monthlyBudget * (index + 1);

    // Add this month's revenue to cumulative total
    if (revenueByMonth.has(index)) {
      cumulativeRevenue += revenueByMonth.get(index)!;
    }

    // Show revenue for months up to and including the last month with data
    // (revenue persists once earned)
    const showRevenue = index <= lastMonthWithData;

    return {
      month: monthName,
      target: Math.round(cumulativeTarget),
      budget: Math.round(cumulativeBudget),
      revenue: showRevenue ? Math.round(cumulativeRevenue) : null,
    };
  });
}

/**
 * Aggregate timesheet entries by month for the line chart.
 * Groups entries by YYYY-MM and calculates total revenue.
 *
 * @param entries - Array of timesheet entries
 * @param projectRates - Map of project name to hourly rate
 * @returns Array of monthly aggregates sorted chronologically
 */
export function aggregateEntriesByMonth(
  entries: Array<{
    work_date: string;
    project_name: string;
    total_minutes: number;
  }>,
  projectRates: Map<string, number>
): MonthlyAggregate[] {
  const monthMap = new Map<string, MonthlyAggregate>();

  for (const entry of entries) {
    // Extract YYYY-MM from work_date
    const month = entry.work_date.substring(0, 7);

    if (!monthMap.has(month)) {
      monthMap.set(month, {
        month,
        totalMinutes: 0,
        totalRevenue: 0,
      });
    }

    const aggregate = monthMap.get(month)!;
    const rate = projectRates.get(entry.project_name) ?? 0;
    const hours = entry.total_minutes / 60;

    aggregate.totalMinutes += entry.total_minutes;
    aggregate.totalRevenue += hours * rate;
  }

  // Sort by month chronologically
  const result = Array.from(monthMap.values());
  result.sort((a, b) => a.month.localeCompare(b.month));

  return result;
}

/**
 * Generate mock line chart data for preview/testing.
 * Shows cumulative values with revenue data only through specified month.
 *
 * @param annualBudget - Annual budget (default: $1M)
 * @param targetRatio - Target multiplier (default: 1.8x)
 * @param monthsWithData - Number of months with revenue data (default: current month)
 * @returns Array of 12 line graph data points with cumulative values
 */
export function generateMockLineData(
  annualBudget: number = ANNUAL_BUDGET,
  targetRatio: number = TARGET_RATIO,
  monthsWithData: number = new Date().getMonth() + 1
): LineGraphDataPoint[] {
  const annualTarget = annualBudget * targetRatio;
  const monthlyTarget = annualTarget / 12;
  const monthlyBudget = annualBudget / 12;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Seed-based pseudo-random for consistent preview
  const seededRandom = (seed: number) => {
    const x = Math.sin(seed * 9999) * 10000;
    return x - Math.floor(x);
  };

  let cumulativeRevenue = 0;

  return months.map((month, index) => {
    // Cumulative target and budget
    const cumulativeTarget = Math.round(monthlyTarget * (index + 1));
    const cumulativeBudget = Math.round(monthlyBudget * (index + 1));

    // Only generate revenue for months with data
    if (index >= monthsWithData) {
      return {
        month,
        target: cumulativeTarget,
        budget: cumulativeBudget,
        revenue: null,
      };
    }

    // Generate monthly revenue with some variance (around 85-95% of monthly budget)
    const monthlyRevenue = monthlyBudget * (0.85 + seededRandom(index) * 0.15);
    cumulativeRevenue += monthlyRevenue;

    return {
      month,
      target: cumulativeTarget,
      budget: cumulativeBudget,
      revenue: Math.round(cumulativeRevenue),
    };
  });
}

/**
 * Generate mock pie chart data for preview/testing.
 *
 * @returns Array of pie chart data points
 */
export function generateMockPieData(): PieChartDataPoint[] {
  return [
    { name: 'Kalin Tomanov', value: 42.5 },
    { name: 'Milen Anastasov', value: 38.0 },
    { name: 'Matthew Maday', value: 32.5 },
    { name: 'Ivan Petrov', value: 24.0 },
    { name: 'Other', value: 18.0, color: 'other' },
  ];
}
