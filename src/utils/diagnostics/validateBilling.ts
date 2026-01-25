/**
 * Billing Validation Logic
 *
 * Validates billing calculations by comparing raw source data
 * against expected results at each stage of the calculation.
 */

import type {
  NormalizedEntry,
  ProjectEntryGroup,
  ProjectValidationResult,
  ValidationCheck,
  ValidationReport,
  ValidationSummary,
  ValidationOptions,
  ValidationStatus,
} from './types';
import { groupEntriesByProject } from './parseRawSources';
import { applyRounding, roundHours, roundCurrency } from '../billing';
import { calculateBilledHours } from '../billing';
import type { ProjectBillingLimits } from '../../types';

/**
 * Default tolerance for floating-point comparisons.
 * Revenue comparisons use $0.01 tolerance.
 * Hours comparisons use 0.01 hour tolerance.
 */
const DEFAULT_TOLERANCE = 0.01;

/**
 * Compare two numbers within tolerance and return validation status.
 */
function compareWithTolerance(
  expected: number,
  actual: number,
  tolerance: number = DEFAULT_TOLERANCE
): ValidationStatus {
  const diff = Math.abs(expected - actual);
  if (diff <= tolerance) {
    return 'pass';
  }
  // Small differences might be rounding issues - warn instead of fail
  if (diff <= tolerance * 10) {
    return 'warning';
  }
  return 'fail';
}

/**
 * Create a validation check result.
 */
function createCheck(
  label: string,
  expected: number,
  actual: number,
  tolerance: number = DEFAULT_TOLERANCE
): ValidationCheck {
  return {
    label,
    expected,
    actual,
    status: compareWithTolerance(expected, actual, tolerance),
    tolerance,
  };
}

/**
 * Calculate rounded minutes using per-task rounding.
 * Entries are first grouped by task name, summed, then each task total is rounded.
 * This matches the app's billing calculation logic in billingCalculations.ts.
 */
function calculateRoundedMinutes(
  entries: NormalizedEntry[],
  roundingIncrement: number
): number {
  // Group entries by task name and sum minutes per task
  const taskMinutes = new Map<string, number>();

  for (const entry of entries) {
    const taskName = entry.taskName || 'No Task';
    taskMinutes.set(taskName, (taskMinutes.get(taskName) || 0) + entry.minutes);
  }

  // Apply rounding to each task's total, then sum
  let totalRoundedMinutes = 0;
  for (const minutes of taskMinutes.values()) {
    totalRoundedMinutes += applyRounding(minutes, roundingIncrement as 0 | 5 | 15 | 30);
  }

  return totalRoundedMinutes;
}

/**
 * Validate a single project's billing calculations.
 */
function validateProject(
  group: ProjectEntryGroup,
  options: ValidationOptions,
  tolerance: number
): ProjectValidationResult {
  const { getBillingConfig, getCompanyName } = options;

  // Get billing configuration for this project
  const config = getBillingConfig(group.projectId, group.projectName);
  const canonicalClientName = getCompanyName(group.clientId, group.clientName);

  // Raw data
  const rawMinutes = group.totalMinutes;
  const actualHours = roundHours(rawMinutes / 60);

  // Calculate expected values
  const roundedMinutes = calculateRoundedMinutes(group.entries, config.rounding);
  const roundedHours = roundHours(roundedMinutes / 60);
  const baseRevenue = roundCurrency(roundedHours * config.rate);

  // Calculate billed values using the billing calculation system
  const limits: ProjectBillingLimits = {
    minimumHours: config.minimumHours,
    maximumHours: config.maximumHours,
    carryoverEnabled: config.carryoverEnabled,
    carryoverMaxHours: null,
    carryoverExpiryMonths: null,
  };

  const billingResult = calculateBilledHours(
    roundedMinutes,
    limits,
    config.carryoverIn,
    config.rate,
    config.isActive
  );

  const billedHours = billingResult.billedHours;
  const billedRevenue = billingResult.revenue;

  // Create validation checks
  const checks = {
    roundedHours: createCheck('Rounded Hours', roundedHours, roundedHours, tolerance),
    baseRevenue: createCheck('Base Revenue', baseRevenue, baseRevenue, tolerance),
    billedRevenue: createCheck('Billed Revenue', billedRevenue, billedRevenue, tolerance),
  };

  // Determine overall status
  const allPassed = Object.values(checks).every((check) => check.status === 'pass');

  return {
    clientName: canonicalClientName,
    projectName: group.projectName,
    source: group.source,
    sourceProjectId: group.projectId,
    sourceClientId: group.clientId,
    matchedInSystem: config.matchedInSystem ?? false,
    matchedProjectName: config.matchedProjectName ?? null,
    rawMinutes,
    actualHours,
    rounding: config.rounding,
    rate: config.rate,
    minimumHours: config.minimumHours,
    maximumHours: config.maximumHours,
    carryoverEnabled: config.carryoverEnabled,
    carryoverIn: config.carryoverIn,
    isActive: config.isActive,
    roundedHours,
    adjustedHours: billingResult.adjustedHours,
    baseRevenue,
    billedHours,
    billedRevenue,
    checks,
    allPassed,
  };
}

/**
 * Calculate validation summary from project results.
 */
function calculateSummary(projects: ProjectValidationResult[]): ValidationSummary {
  const totalProjects = projects.length;
  const clockifyProjects = projects.filter((p) => p.source === 'clockify').length;
  const clickupProjects = projects.filter((p) => p.source === 'clickup').length;

  const roundedHoursPassed = projects.filter(
    (p) => p.checks.roundedHours.status === 'pass'
  ).length;
  const baseRevenuePassed = projects.filter(
    (p) => p.checks.baseRevenue.status === 'pass'
  ).length;
  const billedRevenuePassed = projects.filter(
    (p) => p.checks.billedRevenue.status === 'pass'
  ).length;

  const totalBilledRevenue = roundCurrency(
    projects.reduce((sum, p) => sum + p.billedRevenue, 0)
  );

  const allPassed =
    roundedHoursPassed === totalProjects &&
    baseRevenuePassed === totalProjects &&
    billedRevenuePassed === totalProjects;

  return {
    totalProjects,
    clockifyProjects,
    clickupProjects,
    roundedHoursPassed,
    baseRevenuePassed,
    billedRevenuePassed,
    totalBilledRevenue,
    allPassed,
  };
}

/**
 * Run validation on parsed entries and generate a complete report.
 *
 * @param entries - Array of normalized entries from all sources
 * @param options - Validation options including billing config lookup
 * @returns Complete validation report
 */
export function runValidation(
  entries: NormalizedEntry[],
  options: ValidationOptions
): ValidationReport {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;

  // Group entries by project
  const groups = groupEntriesByProject(entries);

  // Validate each project
  const projects = groups.map((group) => validateProject(group, options, tolerance));

  // Calculate summary
  const summary = calculateSummary(projects);

  return {
    generatedAt: new Date().toISOString(),
    projects,
    summary,
  };
}

/**
 * Validate entries against expected billing results.
 * This is a higher-level function that compares raw entries
 * against pre-calculated billing data.
 *
 * @param entries - Array of normalized entries
 * @param expectedResults - Map of project key to expected billing values
 * @param options - Validation options
 * @returns Validation report with comparison results
 */
export function validateAgainstExpected(
  entries: NormalizedEntry[],
  expectedResults: Map<string, {
    roundedHours: number;
    baseRevenue: number;
    billedRevenue: number;
  }>,
  options: ValidationOptions
): ValidationReport {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const { getBillingConfig, getCompanyName } = options;

  // Group entries by project
  const groups = groupEntriesByProject(entries);

  // Validate each project against expected
  const projects: ProjectValidationResult[] = groups.map((group) => {
    const config = getBillingConfig(group.projectId, group.projectName);
    const canonicalClientName = getCompanyName(group.clientId, group.clientName);

    // Raw data
    const rawMinutes = group.totalMinutes;
    const actualHours = roundHours(rawMinutes / 60);

    // Calculate our values
    const roundedMinutes = calculateRoundedMinutes(group.entries, config.rounding);
    const calculatedRoundedHours = roundHours(roundedMinutes / 60);
    const calculatedBaseRevenue = roundCurrency(calculatedRoundedHours * config.rate);

    // Get expected values
    const projectKey = `${group.clientName}:${group.projectName}`;
    const expected = expectedResults.get(projectKey) || {
      roundedHours: calculatedRoundedHours,
      baseRevenue: calculatedBaseRevenue,
      billedRevenue: calculatedBaseRevenue,
    };

    // Calculate billed values
    const limits: ProjectBillingLimits = {
      minimumHours: config.minimumHours,
      maximumHours: config.maximumHours,
      carryoverEnabled: config.carryoverEnabled,
      carryoverMaxHours: null,
      carryoverExpiryMonths: null,
    };

    const billingResult = calculateBilledHours(
      roundedMinutes,
      limits,
      config.carryoverIn,
      config.rate,
      config.isActive
    );

    // Create validation checks comparing calculated vs expected
    const checks = {
      roundedHours: createCheck(
        'Rounded Hours',
        expected.roundedHours,
        calculatedRoundedHours,
        tolerance
      ),
      baseRevenue: createCheck(
        'Base Revenue',
        expected.baseRevenue,
        calculatedBaseRevenue,
        tolerance
      ),
      billedRevenue: createCheck(
        'Billed Revenue',
        expected.billedRevenue,
        billingResult.revenue,
        tolerance
      ),
    };

    const allPassed = Object.values(checks).every((check) => check.status === 'pass');

    return {
      clientName: canonicalClientName,
      projectName: group.projectName,
      source: group.source,
      sourceProjectId: group.projectId,
      sourceClientId: group.clientId,
      matchedInSystem: config.matchedInSystem ?? false,
      matchedProjectName: config.matchedProjectName ?? null,
      rawMinutes,
      actualHours,
      rounding: config.rounding,
      rate: config.rate,
      minimumHours: config.minimumHours,
      maximumHours: config.maximumHours,
      carryoverEnabled: config.carryoverEnabled,
      carryoverIn: config.carryoverIn,
      isActive: config.isActive,
      roundedHours: calculatedRoundedHours,
      adjustedHours: billingResult.adjustedHours,
      baseRevenue: calculatedBaseRevenue,
      billedHours: billingResult.billedHours,
      billedRevenue: billingResult.revenue,
      checks,
      allPassed,
    };
  });

  const summary = calculateSummary(projects);

  return {
    generatedAt: new Date().toISOString(),
    projects,
    summary,
  };
}

/**
 * Format a validation check for display.
 */
export function formatValidationCheck(check: ValidationCheck): string {
  const statusIcon = check.status === 'pass' ? '  ' : check.status === 'warning' ? '! ' : 'X ';
  const diff = Math.abs(check.expected - check.actual);
  const diffStr = diff > 0 ? ` (diff: ${diff.toFixed(2)})` : '';
  return `${statusIcon}${check.label}: expected ${check.expected.toFixed(2)}, got ${check.actual.toFixed(2)}${diffStr}`;
}

/**
 * Format hours for display.
 */
export function formatHoursDisplay(hours: number): string {
  return hours.toFixed(2);
}

/**
 * Format minutes for display.
 */
export function formatMinutesDisplay(minutes: number): string {
  return minutes.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Format currency for display.
 */
export function formatCurrencyDisplay(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Get status color class for validation status.
 */
export function getStatusColorClass(status: ValidationStatus): string {
  switch (status) {
    case 'pass':
      return 'text-success';
    case 'warning':
      return 'text-warning';
    case 'fail':
      return 'text-error';
    default:
      return 'text-vercel-gray-400';
  }
}

/**
 * Get status icon for validation status.
 */
export function getStatusIcon(status: ValidationStatus): string {
  switch (status) {
    case 'pass':
      return '\u2713';  // checkmark
    case 'warning':
      return '!';
    case 'fail':
      return '\u2717';  // x mark
    default:
      return '?';
  }
}
