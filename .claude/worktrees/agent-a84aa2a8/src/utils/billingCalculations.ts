/**
 * Billing Calculation Types
 *
 * Type definitions for the billing hierarchy.
 * Calculation functions have been removed — billing is now computed by
 * the SQL summary table (project_monthly_summary) and read via useSummaryBilling.
 *
 * Hierarchy:
 * 1. Task → TaskBillingResult
 * 2. Project → ProjectBillingResult (MIN/MAX/CARRYOVER)
 * 3. Company → CompanyBillingResult
 * 4. Monthly → MonthlyBillingResult
 *
 * @official 2026-02-10
 */

import type {
  RoundingIncrement,
  BilledHoursResult,
} from '../types';

// ============================================================================
// TYPES
// ============================================================================

/** Input for a single task */
export interface TaskInput {
  taskName: string;
  totalMinutes: number;
}

/** Result of task-level billing calculation */
export interface TaskBillingResult {
  taskName: string;
  actualMinutes: number;
  roundedMinutes: number;
  actualHours: number;
  roundedHours: number;
  /** Revenue before project-level adjustments (rounded hours * rate) */
  baseRevenue: number;
}

/** Billing configuration for a project */
export interface ProjectBillingConfig {
  rate: number;
  rounding: RoundingIncrement;
  minimumHours: number | null;
  maximumHours: number | null;
  isActive: boolean;
  carryoverEnabled: boolean;
  carryoverHoursIn: number;
  carryoverMaxHours: number | null;
  carryoverExpiryMonths: number | null;
}

/** Input for a project */
export interface ProjectInput {
  projectId: string | null;
  projectName: string;
  tasks: TaskInput[];
  billingConfig: ProjectBillingConfig;
}

/** Result of project-level billing calculation */
export interface ProjectBillingResult {
  projectId: string | null;
  projectName: string;

  // Task-level aggregates (before billing adjustments)
  actualMinutes: number;
  roundedMinutes: number;
  actualHours: number;
  roundedHours: number;

  // Billing adjustments
  carryoverIn: number;
  adjustedHours: number;      // roundedHours + carryoverIn
  billedHours: number;        // After MIN/MAX applied
  unbillableHours: number;    // Hours lost to MAX cap (when carryover disabled)
  carryoverOut: number;       // Hours carried to next month
  minimumPadding: number;     // Hours added due to MIN

  // Flags
  minimumApplied: boolean;
  maximumApplied: boolean;
  hasBillingLimits: boolean;

  // Revenue
  baseRevenue: number;        // roundedHours * rate (before adjustments)
  billedRevenue: number;      // Final revenue after MIN/MAX

  // Configuration used
  rate: number;
  rounding: RoundingIncrement;

  // Detailed task results
  tasks: TaskBillingResult[];

  // Raw billing result for debugging
  billingResult: BilledHoursResult | null;
}

/** Input for a company */
export interface CompanyInput {
  companyId: string;
  companyName: string;
  projects: ProjectInput[];
}

/** Result of company-level billing calculation */
export interface CompanyBillingResult {
  companyId: string;
  companyName: string;

  // Aggregated hours
  actualMinutes: number;
  roundedMinutes: number;
  actualHours: number;
  roundedHours: number;
  adjustedHours: number;
  billedHours: number;
  unbillableHours: number;

  // Aggregated revenue
  baseRevenue: number;
  billedRevenue: number;

  // Projects
  projects: ProjectBillingResult[];
}

/** Result of monthly billing calculation */
export interface MonthlyBillingResult {
  // Aggregated hours
  actualMinutes: number;
  roundedMinutes: number;
  actualHours: number;
  roundedHours: number;
  adjustedHours: number;
  billedHours: number;
  unbillableHours: number;

  // Aggregated revenue
  baseRevenue: number;
  billedRevenue: number;

  // Companies
  companies: CompanyBillingResult[];
}

/**
 * Canonical company info returned by getCanonicalCompany
 */
export interface CanonicalCompanyResult {
  /** The canonical (primary) company's client_id - use this for grouping */
  canonicalClientId: string;
  /** The canonical company's display name */
  canonicalDisplayName: string;
}

/**
 * Build billing inputs from timesheet entries and billing configuration.
 * This is the bridge between raw database data and the unified billing functions.
 */
export interface BuildBillingInputsParams {
  entries: Array<{
    project_id: string | null;
    project_name: string;
    task_name: string | null;
    total_minutes: number;
  }>;
  /** Function to get billing config for a project (ID-only lookup) */
  getBillingConfig: (projectId: string) => ProjectBillingConfig;
  /**
   * Function to get canonical company info by PROJECT ID (not client_id).
   * Returns both canonical ID (for grouping) and canonical name (for display).
   * CRITICAL: Uses project's company relationship for proper grouping.
   */
  getCanonicalCompanyByProject: (projectId: string) => CanonicalCompanyResult;
}
