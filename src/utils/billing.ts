import type { ProjectSummary, Project, BillingMode, RoundingIncrement } from '../types';

// ============================================================================
// Employee Billing Constants & Utilities
// ============================================================================

/** Default expected hours for full-time employees */
export const DEFAULT_EXPECTED_HOURS = 160;

/**
 * Calculate effective hourly rate for an employee/resource
 * Returns actual hourly_rate for hourly billing, or calculated rate for monthly
 */
export function getEffectiveHourlyRate(
  billingMode: BillingMode,
  hourlyRate: number | null,
  monthlyCost: number | null,
  expectedHours: number | null
): number | null {
  if (billingMode === 'hourly') {
    return hourlyRate;
  }

  const hours = expectedHours ?? DEFAULT_EXPECTED_HOURS;
  if (hours <= 0 || monthlyCost == null) {
    return null;
  }

  return monthlyCost / hours;
}

/**
 * Format hours value for display
 */
export function formatHours(value: number | null): string {
  if (value == null) return '—';
  // Show integer if whole number, otherwise show 2 decimals
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(2);
}

// ============================================================================
// Time Rounding Utilities
// ============================================================================

/**
 * Default rounding increment (15 minutes)
 */
export const DEFAULT_ROUNDING_INCREMENT: RoundingIncrement = 15;

/**
 * Apply rounding to minutes based on the specified increment.
 * - 0 (Actual): No rounding, returns exact minutes
 * - 5, 15, 30: Rounds up to the nearest increment
 *
 * @param minutes - The actual minutes to round
 * @param increment - The rounding increment (0, 5, 15, or 30)
 * @returns The rounded minutes
 */
export function applyRounding(minutes: number, increment: RoundingIncrement): number {
  if (increment === 0) return minutes;
  return Math.ceil(minutes / increment) * increment;
}

/**
 * Get display label for a rounding increment.
 */
export function getRoundingDisplayLabel(increment: RoundingIncrement): string {
  switch (increment) {
    case 0:
      return 'Actual';
    case 5:
      return '5 min';
    case 15:
      return '15 min';
    case 30:
      return '30 min';
    default:
      return `${increment} min`;
  }
}

// ============================================================================
// Project Billing Constants & Utilities
// ============================================================================

export interface ProjectRate {
  projectName: string;
  hourlyRate: number;
}

// Default fallback rate when no rate is specified
export const DEFAULT_FALLBACK_RATE = 45.00;

// Legacy default rates (for backwards compatibility with localStorage)
const LEGACY_RATES: Record<string, number> = {
  'FoodCycleScience': 60.00,
  'Neocurrency': 52.36,
  'MPS 2.0': 45.00,
  'Crossroads': 50.00,
  'Client Services': 45.00,
  'Yavor-M': 50.00,
  'ACE': 40.00,
  'ShoreCapital': 50.00,
  'One Wealth Management': 80.00,
};

const STORAGE_KEY = 'timesheet_billing_rates';

/**
 * Build a rate lookup from database projects
 * Key is project_id (from n8n) for accurate matching
 */
export function buildDbRateLookup(projects: Project[]): Map<string, number> {
  const lookup = new Map<string, number>();
  projects.forEach(project => {
    // Only add to lookup if rate is explicitly set (including 0)
    if (project.rate !== null) {
      lookup.set(project.project_id, project.rate);
    }
  });
  return lookup;
}

/**
 * Build a rate lookup by project name from database projects
 * Key is project_name for display/report matching
 */
export function buildDbRateLookupByName(projects: Project[]): Map<string, number> {
  const lookup = new Map<string, number>();
  projects.forEach(project => {
    if (project.rate !== null) {
      lookup.set(project.project_name, project.rate);
    }
  });
  return lookup;
}

/**
 * Get rate for a project with proper fallback logic
 * Priority: Database rate > Legacy localStorage rate > Default $45
 */
export function getEffectiveRate(
  projectName: string,
  dbRateLookup?: Map<string, number>,
  legacyRates?: Record<string, number>
): number {
  // Check database lookup first
  if (dbRateLookup?.has(projectName)) {
    return dbRateLookup.get(projectName)!;
  }

  // Fall back to legacy localStorage rates
  if (legacyRates && legacyRates[projectName] !== undefined) {
    return legacyRates[projectName];
  }

  // Ultimate fallback
  return DEFAULT_FALLBACK_RATE;
}

/**
 * Get all billing rates from localStorage, merged with legacy defaults
 * @deprecated Use database rates instead
 */
export function getBillingRates(): Record<string, number> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with legacy defaults (stored rates take precedence)
      return { ...LEGACY_RATES, ...parsed };
    }
  } catch (e) {
    console.error('Error reading billing rates:', e);
  }
  return { ...LEGACY_RATES };
}

/**
 * Save billing rates to localStorage
 * @deprecated Use database rates instead
 */
export function saveBillingRates(rates: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rates));
  } catch (e) {
    console.error('Error saving billing rates:', e);
  }
}

/**
 * Get the hourly rate for a specific project
 * @deprecated Use getEffectiveRate instead
 */
export function getProjectRate(projectName: string): number {
  const rates = getBillingRates();
  return rates[projectName] ?? DEFAULT_FALLBACK_RATE;
}

/**
 * Set the hourly rate for a specific project
 * @deprecated Use database rates instead
 */
export function setProjectRate(projectName: string, rate: number): void {
  const rates = getBillingRates();
  rates[projectName] = rate;
  saveBillingRates(rates);
}

/**
 * Calculate revenue for a single project
 * Uses database rates with $45 fallback, then legacy localStorage rates
 * Applies per-task rounding: each task is rounded individually, then summed
 */
export function calculateProjectRevenue(
  project: ProjectSummary,
  rates: Record<string, number>,
  dbRateLookup?: Map<string, number>,
  roundingIncrement: RoundingIncrement = DEFAULT_ROUNDING_INCREMENT
): number {
  // Apply rounding to each task individually, then sum
  let roundedMinutes = 0;
  for (const resource of project.resources) {
    for (const task of resource.tasks) {
      roundedMinutes += applyRounding(task.totalMinutes, roundingIncrement);
    }
  }
  const hours = roundedMinutes / 60;
  const rate = getEffectiveRate(project.projectName, dbRateLookup, rates);
  return hours * rate;
}

/**
 * Calculate total revenue across all projects
 * Uses database rates with $45 fallback, then legacy localStorage rates
 */
export function calculateTotalRevenue(
  projects: ProjectSummary[],
  rates: Record<string, number>,
  dbRateLookup?: Map<string, number>
): number {
  return projects.reduce((total, project) => {
    return total + calculateProjectRevenue(project, rates, dbRateLookup);
  }, 0);
}

/**
 * Get project rates as an array (for table display)
 * Includes all projects from data + any stored rates
 * Uses database rates with proper fallback
 */
export function getProjectRatesArray(
  projects: ProjectSummary[],
  dbRateLookup?: Map<string, number>
): ProjectRate[] {
  const rates = getBillingRates();

  // Get all unique project names (from data + stored rates)
  const projectNames = new Set<string>();
  projects.forEach(p => projectNames.add(p.projectName));
  Object.keys(rates).forEach(name => projectNames.add(name));

  return Array.from(projectNames)
    .sort()
    .map(projectName => ({
      projectName,
      hourlyRate: getEffectiveRate(projectName, dbRateLookup, rates),
    }));
}

/**
 * Format currency for display
 * Returns '—' for null/undefined values
 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
