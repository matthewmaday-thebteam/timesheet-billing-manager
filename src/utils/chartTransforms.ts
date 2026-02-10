/**
 * Chart Data Transformers
 *
 * Utility functions to transform application data into chart-ready formats.
 *
 * @official 2026-01-11
 * @category Utils
 */

import type { ResourceSummary } from '../types';
import type {
  PieChartDataPoint,
  LineGraphDataPoint,
  MonthlyAggregate,
  MoMGrowthDataPoint,
  CAGRProjectionDataPoint,
} from '../types/charts';
import { TARGET_RATIO, ANNUAL_BUDGET, TOP_N_RESOURCES } from '../config/chartConfig';

/**
 * Historical annual revenue data (hardcoded).
 * Used for CAGR calculation and projection.
 */
export const HISTORICAL_ANNUAL_REVENUE: Record<number, number> = {
  2022: 846852,
  2023: 1187720,
  2024: 1245857,
  2025: 1580000,
};

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
 * - Revenue: Cumulative earned revenue that extends as flat line into future months
 * - Best/Worst Case: Projections based on current growth rate with variance
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

  // Find the last month with revenue data and calculate average monthly revenue
  let lastMonthWithData = -1;
  let totalRevenue = 0;
  let monthsWithRevenue = 0;
  for (let i = 0; i < 12; i++) {
    if (revenueByMonth.has(i)) {
      lastMonthWithData = i;
      totalRevenue += revenueByMonth.get(i)!;
      monthsWithRevenue++;
    }
  }

  // Calculate average monthly revenue for projections
  const avgMonthlyRevenue = monthsWithRevenue > 0 ? totalRevenue / monthsWithRevenue : 0;

  // Variance for best/worst case (20% above/below average growth)
  const bestCaseMultiplier = 1.2;
  const worstCaseMultiplier = 0.8;

  // Generate cumulative values for full year
  let cumulativeRevenue = 0;

  return months.map((monthName, index) => {
    // Cumulative target and budget (compounds each month)
    const cumulativeTarget = monthlyTarget * (index + 1);
    const cumulativeBudget = monthlyBudget * (index + 1);

    // Add this month's revenue to cumulative total (only for months with data)
    if (revenueByMonth.has(index)) {
      cumulativeRevenue += revenueByMonth.get(index)!;
    }

    // Revenue extends as flat line into future months once earned
    // Show null only for months before any data exists
    const hasAnyData = lastMonthWithData >= 0;
    const showRevenue = hasAnyData && index >= 0;

    // Calculate projections for future months (after last month with data)
    let bestCase: number | null = null;
    let worstCase: number | null = null;

    if (hasAnyData && index > lastMonthWithData) {
      // Number of months into the future from last data point
      const monthsAhead = index - lastMonthWithData;

      // Best case: current revenue + (months ahead × avg monthly × best multiplier)
      bestCase = Math.round(cumulativeRevenue + (monthsAhead * avgMonthlyRevenue * bestCaseMultiplier));

      // Worst case: current revenue + (months ahead × avg monthly × worst multiplier)
      worstCase = Math.round(cumulativeRevenue + (monthsAhead * avgMonthlyRevenue * worstCaseMultiplier));
    }

    return {
      month: monthName,
      target: Math.round(cumulativeTarget),
      budget: Math.round(cumulativeBudget),
      revenue: showRevenue ? Math.round(cumulativeRevenue) : null,
      bestCase,
      worstCase,
    };
  });
}

/**
 * Aggregate timesheet entries by month for the line chart.
 * Groups entries by YYYY-MM and calculates total revenue.
 *
 * @param entries - Array of timesheet entries
 * @param projectRates - Map of external project_id to hourly rate
 * @param projectCanonicalIdLookup - Optional map from external project_id to canonical project_id
 * @returns Array of monthly aggregates sorted chronologically
 */
export function aggregateEntriesByMonth(
  entries: Array<{
    work_date: string;
    project_id: string | null;
    project_name: string;
    total_minutes: number;
  }>,
  projectRates: Map<string, number>,
  projectCanonicalIdLookup?: Map<string, string>
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

    // Get canonical project ID for rate lookup
    const projectId = entry.project_id || '';
    const canonicalProjectId = projectCanonicalIdLookup?.get(projectId) || projectId;
    const rate = projectRates.get(canonicalProjectId) ?? 0;
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
 * Aggregate per-project revenue by month from timesheet entries.
 * Returns a nested map: month key (YYYY-MM) → canonical project ID → revenue (dollars).
 * Used for milestone adjustment calculations across all chart months.
 *
 * @param entries - Array of timesheet entries (extended range)
 * @param projectRates - Map of external project_id to hourly rate (base rates)
 * @param projectCanonicalIdLookup - Optional map from external project_id to canonical project_id
 * @returns Nested map of month → project → revenue
 */
export function aggregateProjectRevenueByMonth(
  entries: Array<{
    work_date: string;
    project_id: string | null;
    total_minutes: number;
  }>,
  projectRates: Map<string, number>,
  projectCanonicalIdLookup?: Map<string, string>
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();

  for (const entry of entries) {
    const month = entry.work_date.substring(0, 7);
    const projectId = entry.project_id || '';
    const canonicalProjectId = projectCanonicalIdLookup?.get(projectId) || projectId;
    const rate = projectRates.get(canonicalProjectId) ?? 0;
    const revenue = (entry.total_minutes / 60) * rate;

    if (!result.has(month)) {
      result.set(month, new Map());
    }
    const monthMap = result.get(month)!;
    monthMap.set(
      canonicalProjectId,
      (monthMap.get(canonicalProjectId) || 0) + revenue
    );
  }

  return result;
}

/**
 * Generate mock line chart data for preview/testing.
 * Shows cumulative values with revenue extending as flat line into future months.
 *
 * @param annualBudget - Annual budget (default: $1M)
 * @param targetRatio - Target multiplier (default: 1.8x)
 * @param monthsWithData - Number of months with actual revenue data (default: current month)
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
  const avgMonthlyRevenue = monthlyBudget * 0.9; // Mock average

  return months.map((month, index) => {
    // Cumulative target and budget
    const cumulativeTarget = Math.round(monthlyTarget * (index + 1));
    const cumulativeBudget = Math.round(monthlyBudget * (index + 1));

    // Generate monthly revenue with some variance for months with actual data
    if (index < monthsWithData) {
      const monthlyRevenue = monthlyBudget * (0.85 + seededRandom(index) * 0.15);
      cumulativeRevenue += monthlyRevenue;
    }
    // For future months, cumulativeRevenue stays at last earned value (flat line)

    // Calculate projections for future months
    let bestCase: number | null = null;
    let worstCase: number | null = null;

    if (index >= monthsWithData) {
      const monthsAhead = index - monthsWithData + 1;
      bestCase = Math.round(cumulativeRevenue + (monthsAhead * avgMonthlyRevenue * 1.2));
      worstCase = Math.round(cumulativeRevenue + (monthsAhead * avgMonthlyRevenue * 0.8));
    }

    return {
      month,
      target: cumulativeTarget,
      budget: cumulativeBudget,
      revenue: Math.round(cumulativeRevenue),
      bestCase,
      worstCase,
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

/**
 * Transform monthly aggregates into MoM (Month-over-Month) growth rate data.
 * Shows percentage change from previous month.
 *
 * @param monthlyAggregates - Array of monthly aggregate data
 * @returns Array of 12 MoM growth data points
 */
export function transformToMoMGrowthData(
  monthlyAggregates: MonthlyAggregate[]
): MoMGrowthDataPoint[] {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Build a map of month index (0-11) to monthly revenue
  const revenueByMonth = new Map<number, number>();
  for (const aggregate of monthlyAggregates) {
    const monthIndex = parseInt(aggregate.month.split('-')[1]) - 1;
    revenueByMonth.set(monthIndex, aggregate.totalRevenue);
  }

  return months.map((monthName, index) => {
    const currentRevenue = revenueByMonth.get(index);
    const previousRevenue = revenueByMonth.get(index - 1);

    let growthRate: number | null = null;

    // Calculate MoM growth rate if we have both current and previous month data
    if (currentRevenue !== undefined && previousRevenue !== undefined && previousRevenue > 0) {
      growthRate = ((currentRevenue - previousRevenue) / previousRevenue) * 100;
    }

    return {
      month: monthName,
      value: growthRate !== null ? Math.round(growthRate * 10) / 10 : null,
      revenue: currentRevenue ?? 0,
    };
  });
}

/**
 * Transform historical annual revenue into CAGR projection data.
 * Uses hardcoded annual revenue (2022-2025) and projects future years.
 * Formula: CAGR = (End/Start)^(1/n) - 1
 *
 * @param _monthlyAggregates - Unused, kept for API compatibility
 * @param projectYears - Number of years to project forward (default: 2)
 * @returns Array of CAGR projection data points by year
 */
export function transformToCAGRProjectionData(
  _monthlyAggregates: MonthlyAggregate[],
  projectYears: number = 2
): CAGRProjectionDataPoint[] {
  const historicalYears = Object.keys(HISTORICAL_ANNUAL_REVENUE)
    .map(Number)
    .sort((a, b) => a - b);

  if (historicalYears.length < 2) {
    return [];
  }

  // Calculate CAGR from first to last historical year
  const startYear = historicalYears[0];
  const endYear = historicalYears[historicalYears.length - 1];
  const startValue = HISTORICAL_ANNUAL_REVENUE[startYear];
  const endValue = HISTORICAL_ANNUAL_REVENUE[endYear];
  const numYears = endYear - startYear;

  // CAGR = (End/Start)^(1/n) - 1
  const cagr = Math.pow(endValue / startValue, 1 / numYears) - 1;

  const result: CAGRProjectionDataPoint[] = [];

  // Add historical years as actual data
  for (const year of historicalYears) {
    result.push({
      month: String(year), // Using 'month' field for year label
      actual: HISTORICAL_ANNUAL_REVENUE[year],
      projected: null,
    });
  }

  // Project future years using CAGR
  let lastValue = endValue;
  for (let i = 1; i <= projectYears; i++) {
    const projectedYear = endYear + i;
    lastValue = lastValue * (1 + cagr);
    result.push({
      month: String(projectedYear),
      actual: null,
      projected: Math.round(lastValue),
    });
  }

  return result;
}

/** Year-over-year growth rate data */
export interface YoYGrowthRate {
  fromYear: number;
  toYear: number;
  rate: number; // Percentage (e.g., 40.3 for 40.3%)
}

/**
 * Calculate summary statistics for growth display.
 * Uses hardcoded historical annual revenue for CAGR calculation.
 *
 * @param monthlyAggregates - Array of monthly aggregate data (used for MoM stats)
 * @returns Object with CAGR, projected revenue, and current stats
 */
export function calculateGrowthStats(monthlyAggregates: MonthlyAggregate[]): {
  avgMoMGrowth: number | null;
  projectedAnnualRevenue: number | null;
  currentCumulativeRevenue: number;
  monthsWithData: number;
  cagr: number | null;
  yoyGrowthRates: YoYGrowthRate[];
} {
  // Calculate CAGR and YoY growth rates from historical annual data
  const historicalYears = Object.keys(HISTORICAL_ANNUAL_REVENUE)
    .map(Number)
    .sort((a, b) => a - b);

  let cagr: number | null = null;
  let projectedAnnualRevenue: number | null = null;
  const yoyGrowthRates: YoYGrowthRate[] = [];

  if (historicalYears.length >= 2) {
    const startYear = historicalYears[0];
    const endYear = historicalYears[historicalYears.length - 1];
    const startValue = HISTORICAL_ANNUAL_REVENUE[startYear];
    const endValue = HISTORICAL_ANNUAL_REVENUE[endYear];
    const numYears = endYear - startYear;

    // CAGR = (End/Start)^(1/n) - 1
    cagr = (Math.pow(endValue / startValue, 1 / numYears) - 1) * 100;

    // Project next year
    projectedAnnualRevenue = endValue * (1 + cagr / 100);

    // Calculate YoY growth rates for each consecutive year pair
    for (let i = 1; i < historicalYears.length; i++) {
      const fromYear = historicalYears[i - 1];
      const toYear = historicalYears[i];
      const fromValue = HISTORICAL_ANNUAL_REVENUE[fromYear];
      const toValue = HISTORICAL_ANNUAL_REVENUE[toYear];
      const rate = ((toValue - fromValue) / fromValue) * 100;
      yoyGrowthRates.push({ fromYear, toYear, rate });
    }
  }

  // Build a map of month index (0-11) to monthly revenue for MoM stats
  const revenueByMonth = new Map<number, number>();
  for (const aggregate of monthlyAggregates) {
    const monthIndex = parseInt(aggregate.month.split('-')[1]) - 1;
    revenueByMonth.set(monthIndex, aggregate.totalRevenue);
  }

  // Find months with data
  const monthIndicesWithData: number[] = [];
  let cumulativeRevenue = 0;
  for (let i = 0; i < 12; i++) {
    if (revenueByMonth.has(i)) {
      monthIndicesWithData.push(i);
      cumulativeRevenue += revenueByMonth.get(i)!;
    }
  }

  if (monthIndicesWithData.length === 0) {
    return {
      avgMoMGrowth: null,
      projectedAnnualRevenue,
      currentCumulativeRevenue: 0,
      monthsWithData: 0,
      cagr,
      yoyGrowthRates,
    };
  }

  // Calculate MoM growth rates for consecutive months
  const growthRates: number[] = [];
  for (let i = 1; i < monthIndicesWithData.length; i++) {
    const prevIndex = monthIndicesWithData[i - 1];
    const currIndex = monthIndicesWithData[i];
    if (currIndex === prevIndex + 1) {
      const prevRevenue = revenueByMonth.get(prevIndex)!;
      const currRevenue = revenueByMonth.get(currIndex)!;
      if (prevRevenue > 0) {
        growthRates.push((currRevenue - prevRevenue) / prevRevenue);
      }
    }
  }

  const avgMoMGrowth = growthRates.length > 0
    ? (growthRates.reduce((sum, rate) => sum + rate, 0) / growthRates.length) * 100
    : null;

  return {
    avgMoMGrowth,
    projectedAnnualRevenue,
    currentCumulativeRevenue: cumulativeRevenue,
    monthsWithData: monthIndicesWithData.length,
    cagr,
    yoyGrowthRates,
  };
}
