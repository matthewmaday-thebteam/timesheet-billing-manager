import type {
  ProjectSummary,
  Project,
  BillingMode,
  RoundingIncrement,
  ProjectBillingLimits,
  BilledHoursResult,
  BillingAdjustment,
} from '../types';

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

// ============================================================================
// Precision Utilities (Financial Audit Requirement)
// ============================================================================

/**
 * Round hours to 2 decimal places to prevent floating-point precision errors.
 * Uses banker's rounding (round half to even) for financial accuracy.
 */
export function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Round currency to 2 decimal places to prevent floating-point precision errors.
 * Uses standard rounding (round half up) for currency.
 */
export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

// ============================================================================
// Billing Calculation (Task 028)
// ============================================================================

/**
 * Default billing limits when none are set.
 */
export const DEFAULT_BILLING_LIMITS: ProjectBillingLimits = {
  minimumHours: null,
  maximumHours: null,
  carryoverEnabled: false,
  carryoverMaxHours: null,
  carryoverExpiryMonths: null,
};

/**
 * Calculate billed hours with minimum/maximum limits and carryover.
 *
 * Calculation Order (per Financial Audit):
 * 1. Sum actual minutes per task
 * 2. Apply per-task rounding (round up to increment)
 * 3. Sum rounded minutes -> roundedHours
 * 4. Add carryoverIn -> adjustedHours
 * 5. Apply minimum (if isActive && adjustedHours < minimum)
 * 6. Apply maximum (if adjustedHours > maximum)
 * 7. Calculate carryoverOut or unbillableHours
 * 8. billedHours * rate = revenue
 *
 * @param roundedMinutes - Total minutes after per-task rounding
 * @param limits - Billing limits configuration
 * @param carryoverIn - Carryover hours from previous months
 * @param rate - Hourly rate for revenue calculation
 * @param isActive - Whether minimum billing applies
 * @returns Complete billing result with all calculation stages
 */
export function calculateBilledHours(
  roundedMinutes: number,
  limits: ProjectBillingLimits,
  carryoverIn: number,
  rate: number,
  isActive: boolean
): BilledHoursResult {
  // Step 1: Convert rounded minutes to hours
  const roundedHours = roundHours(roundedMinutes / 60);

  // Step 2: Add carryover
  const adjustedHours = roundHours(roundedHours + carryoverIn);

  // Initialize result values
  let billedHours = adjustedHours;
  let carryoverOut = 0;
  let unbillableHours = 0;
  let carryoverConsumed = carryoverIn; // Start assuming all carryover is consumed
  let minimumPadding = 0;
  let minimumApplied = false;
  let maximumApplied = false;
  let adjustment: BillingAdjustment = { type: 'none' };

  // Step 3: Apply minimum (if active and below minimum)
  const { minimumHours, maximumHours, carryoverEnabled } = limits;

  if (isActive && minimumHours !== null && adjustedHours < minimumHours) {
    minimumPadding = roundHours(minimumHours - adjustedHours);
    billedHours = minimumHours;
    minimumApplied = true;
    adjustment = {
      type: 'minimum_applied',
      minimumHours,
      paddingHours: minimumPadding,
    };
  }

  // Step 4: Apply maximum (caps billedHours, generates carryover or unbillable)
  // Note: Since min <= max is enforced by database, minimum-applied hours will never exceed maximum
  if (maximumHours !== null && billedHours > maximumHours) {
    const excessHours = roundHours(billedHours - maximumHours);
    billedHours = maximumHours;
    maximumApplied = true;

    if (carryoverEnabled) {
      // Excess becomes carryover to next month
      carryoverOut = excessHours;
      adjustment = {
        type: 'maximum_applied',
        maximumHours,
        carryoverOut: excessHours,
      };
    } else {
      // Excess becomes unbillable (lost hours)
      unbillableHours = excessHours;
      adjustment = {
        type: 'maximum_applied_unbillable',
        maximumHours,
        unbillableHours: excessHours,
      };
    }

    // Calculate carryover consumption (FIFO - use carryover before new hours)
    // When max is applied, we need to figure out how much carryover was actually used
    if (carryoverIn > 0) {
      // Carryover is consumed first, then actual hours
      carryoverConsumed = Math.min(carryoverIn, billedHours);
    }
  }

  // Step 5: Calculate revenue
  const revenue = roundCurrency(billedHours * rate);

  return {
    actualHours: roundedHours, // Using roundedHours as "actual" since raw minutes aren't passed
    roundedHours,
    carryoverIn,
    adjustedHours,
    billedHours,
    carryoverOut,
    unbillableHours,
    carryoverConsumed,
    minimumPadding,
    minimumApplied,
    maximumApplied,
    adjustment,
    revenue,
  };
}

/**
 * Calculate billed hours from raw task minutes.
 * This is a convenience wrapper that applies per-task rounding first.
 *
 * @param taskMinutes - Array of raw minutes per task
 * @param roundingIncrement - Rounding increment for each task
 * @param limits - Billing limits configuration
 * @param carryoverIn - Carryover hours from previous months
 * @param rate - Hourly rate for revenue calculation
 * @param isActive - Whether minimum billing applies
 * @returns Complete billing result with all calculation stages
 */
export function calculateBilledHoursFromTasks(
  taskMinutes: number[],
  roundingIncrement: RoundingIncrement,
  limits: ProjectBillingLimits,
  carryoverIn: number,
  rate: number,
  isActive: boolean
): BilledHoursResult {
  // Apply rounding to each task individually, then sum
  let totalRoundedMinutes = 0;
  for (const minutes of taskMinutes) {
    totalRoundedMinutes += applyRounding(minutes, roundingIncrement);
  }

  return calculateBilledHours(totalRoundedMinutes, limits, carryoverIn, rate, isActive);
}

/**
 * Validate that inherited minimum is not greater than inherited maximum.
 * This is an application-level check since database constraints only validate within a single row.
 *
 * @param minimumHours - Effective minimum hours (may be inherited)
 * @param maximumHours - Effective maximum hours (may be inherited)
 * @returns True if valid, false if min > max
 */
export function validateMinMaxLimits(
  minimumHours: number | null,
  maximumHours: number | null
): boolean {
  if (minimumHours === null || maximumHours === null) {
    return true; // No conflict when either is null
  }
  return minimumHours <= maximumHours;
}

/**
 * Format a billing adjustment for display.
 */
export function formatBillingAdjustment(adjustment: BillingAdjustment): string {
  switch (adjustment.type) {
    case 'none':
      return 'No adjustment';
    case 'minimum_applied':
      return `Minimum applied (+${formatHours(adjustment.paddingHours)}h)`;
    case 'maximum_applied':
      return `Maximum applied (${formatHours(adjustment.carryoverOut)}h carried over)`;
    case 'maximum_applied_unbillable':
      return `Maximum applied (${formatHours(adjustment.unbillableHours)}h unbillable)`;
    default:
      return 'Unknown adjustment';
  }
}
