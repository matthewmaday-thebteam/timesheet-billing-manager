/**
 * Unified Billing Calculations
 *
 * This module provides a single source of truth for all billing calculations.
 * All revenue/hours calculations across the app should use these functions.
 *
 * Hierarchy:
 * 1. Task → calculateTaskBilling()
 * 2. Project → calculateProjectBilling() - applies MIN/MAX/CARRYOVER
 * 3. Company → calculateCompanyBilling()
 * 4. Monthly → calculateMonthlyBilling()
 *
 * @official 2026-01-24
 */

import {
  applyRounding,
  calculateBilledHours,
  roundHours,
  roundCurrency,
  DEFAULT_ROUNDING_INCREMENT,
} from './billing';
import type {
  RoundingIncrement,
  ProjectBillingLimits,
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

/** Default billing config when none is specified */
export const DEFAULT_BILLING_CONFIG: ProjectBillingConfig = {
  rate: 0,
  rounding: DEFAULT_ROUNDING_INCREMENT,
  minimumHours: null,
  maximumHours: null,
  isActive: true,
  carryoverEnabled: false,
  carryoverHoursIn: 0,
  carryoverMaxHours: null,
  carryoverExpiryMonths: null,
};

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

// ============================================================================
// LEVEL 1: TASK BILLING
// ============================================================================

/**
 * Calculate billing for a single task.
 *
 * Formula:
 * 1. actualMinutes = task.totalMinutes
 * 2. roundedMinutes = ROUND_UP(actualMinutes, rounding increment)
 * 3. roundedHours = roundedMinutes / 60
 * 4. baseRevenue = roundedHours * rate
 *
 * Note: Task-level revenue is "base" revenue. Actual billed revenue is
 * determined at the project level after MIN/MAX adjustments.
 */
export function calculateTaskBilling(
  task: TaskInput,
  rounding: RoundingIncrement,
  rate: number
): TaskBillingResult {
  const actualMinutes = task.totalMinutes;
  const roundedMinutes = applyRounding(actualMinutes, rounding);
  const actualHours = roundHours(actualMinutes / 60);
  const roundedHours = roundHours(roundedMinutes / 60);
  const baseRevenue = roundCurrency(roundedHours * rate);

  return {
    taskName: task.taskName,
    actualMinutes,
    roundedMinutes,
    actualHours,
    roundedHours,
    baseRevenue,
  };
}

// ============================================================================
// LEVEL 2: PROJECT BILLING
// ============================================================================

/**
 * Calculate billing for a project (collection of tasks).
 *
 * Formula:
 * 1. For each task: calculate task billing (with rounding)
 * 2. Sum all task roundedMinutes → project roundedMinutes
 * 3. roundedHours = roundedMinutes / 60
 * 4. adjustedHours = roundedHours + carryoverIn
 * 5. Apply MIN: if isActive && adjustedHours < minimumHours → billedHours = minimumHours
 * 6. Apply MAX: if adjustedHours > maximumHours → billedHours = maximumHours
 *    - If carryoverEnabled: excess goes to carryoverOut
 *    - If !carryoverEnabled: excess becomes unbillableHours
 * 7. billedRevenue = billedHours * rate
 */
export function calculateProjectBilling(project: ProjectInput): ProjectBillingResult {
  const { projectId, projectName, tasks, billingConfig } = project;
  const { rate, rounding, minimumHours, maximumHours, isActive, carryoverHoursIn } = billingConfig;

  // Calculate each task
  const taskResults: TaskBillingResult[] = tasks.map(task =>
    calculateTaskBilling(task, rounding, rate)
  );

  // Aggregate task-level totals
  const actualMinutes = taskResults.reduce((sum, t) => sum + t.actualMinutes, 0);
  const roundedMinutes = taskResults.reduce((sum, t) => sum + t.roundedMinutes, 0);
  const actualHours = roundHours(actualMinutes / 60);
  const roundedHours = roundHours(roundedMinutes / 60);
  const baseRevenue = roundCurrency(roundedHours * rate);

  // Check if project has billing limits
  const hasBillingLimits = minimumHours !== null ||
                           maximumHours !== null ||
                           carryoverHoursIn > 0;

  // Apply billing limits
  let billingResult: BilledHoursResult | null = null;
  let carryoverIn = carryoverHoursIn;
  let adjustedHours = roundHours(roundedHours + carryoverIn);
  let billedHours = adjustedHours;
  let unbillableHours = 0;
  let carryoverOut = 0;
  let minimumPadding = 0;
  let minimumApplied = false;
  let maximumApplied = false;
  let billedRevenue = baseRevenue;

  if (hasBillingLimits) {
    const limits: ProjectBillingLimits = {
      minimumHours: billingConfig.minimumHours,
      maximumHours: billingConfig.maximumHours,
      carryoverEnabled: billingConfig.carryoverEnabled,
      carryoverMaxHours: billingConfig.carryoverMaxHours,
      carryoverExpiryMonths: billingConfig.carryoverExpiryMonths,
    };

    billingResult = calculateBilledHours(
      roundedMinutes,
      limits,
      carryoverIn,
      rate,
      isActive
    );

    adjustedHours = billingResult.adjustedHours;
    billedHours = billingResult.billedHours;
    unbillableHours = billingResult.unbillableHours;
    carryoverOut = billingResult.carryoverOut;
    minimumPadding = billingResult.minimumPadding;
    minimumApplied = billingResult.minimumApplied;
    maximumApplied = billingResult.maximumApplied;
    billedRevenue = billingResult.revenue;
  }

  return {
    projectId,
    projectName,
    actualMinutes,
    roundedMinutes,
    actualHours,
    roundedHours,
    carryoverIn,
    adjustedHours,
    billedHours,
    unbillableHours,
    carryoverOut,
    minimumPadding,
    minimumApplied,
    maximumApplied,
    hasBillingLimits,
    baseRevenue,
    billedRevenue,
    rate,
    rounding,
    tasks: taskResults,
    billingResult,
  };
}

// ============================================================================
// LEVEL 3: COMPANY BILLING
// ============================================================================

/**
 * Calculate billing for a company (collection of projects).
 *
 * Formula:
 * 1. For each project: calculate project billing
 * 2. Sum all project billedRevenue → company billedRevenue
 * 3. Sum all project billedHours → company billedHours
 */
export function calculateCompanyBilling(company: CompanyInput): CompanyBillingResult {
  const { companyId, companyName, projects } = company;

  // Calculate each project
  const projectResults: ProjectBillingResult[] = projects.map(project =>
    calculateProjectBilling(project)
  );

  // Aggregate project-level totals
  const actualMinutes = projectResults.reduce((sum, p) => sum + p.actualMinutes, 0);
  const roundedMinutes = projectResults.reduce((sum, p) => sum + p.roundedMinutes, 0);
  const actualHours = roundHours(projectResults.reduce((sum, p) => sum + p.actualHours, 0));
  const roundedHours = roundHours(projectResults.reduce((sum, p) => sum + p.roundedHours, 0));
  const adjustedHours = roundHours(projectResults.reduce((sum, p) => sum + p.adjustedHours, 0));
  const billedHours = roundHours(projectResults.reduce((sum, p) => sum + p.billedHours, 0));
  const unbillableHours = roundHours(projectResults.reduce((sum, p) => sum + p.unbillableHours, 0));
  const baseRevenue = roundCurrency(projectResults.reduce((sum, p) => sum + p.baseRevenue, 0));
  const billedRevenue = roundCurrency(projectResults.reduce((sum, p) => sum + p.billedRevenue, 0));

  return {
    companyId,
    companyName,
    actualMinutes,
    roundedMinutes,
    actualHours,
    roundedHours,
    adjustedHours,
    billedHours,
    unbillableHours,
    baseRevenue,
    billedRevenue,
    projects: projectResults,
  };
}

// ============================================================================
// LEVEL 4: MONTHLY BILLING
// ============================================================================

/**
 * Calculate billing for a month (collection of companies).
 *
 * Formula:
 * 1. For each company: calculate company billing
 * 2. Sum all company billedRevenue → monthly billedRevenue
 * 3. Sum all company billedHours → monthly billedHours
 */
export function calculateMonthlyBilling(companies: CompanyInput[]): MonthlyBillingResult {
  // Calculate each company
  const companyResults: CompanyBillingResult[] = companies.map(company =>
    calculateCompanyBilling(company)
  );

  // Aggregate company-level totals
  const actualMinutes = companyResults.reduce((sum, c) => sum + c.actualMinutes, 0);
  const roundedMinutes = companyResults.reduce((sum, c) => sum + c.roundedMinutes, 0);
  const actualHours = roundHours(companyResults.reduce((sum, c) => sum + c.actualHours, 0));
  const roundedHours = roundHours(companyResults.reduce((sum, c) => sum + c.roundedHours, 0));
  const adjustedHours = roundHours(companyResults.reduce((sum, c) => sum + c.adjustedHours, 0));
  const billedHours = roundHours(companyResults.reduce((sum, c) => sum + c.billedHours, 0));
  const unbillableHours = roundHours(companyResults.reduce((sum, c) => sum + c.unbillableHours, 0));
  const baseRevenue = roundCurrency(companyResults.reduce((sum, c) => sum + c.baseRevenue, 0));
  const billedRevenue = roundCurrency(companyResults.reduce((sum, c) => sum + c.billedRevenue, 0));

  return {
    actualMinutes,
    roundedMinutes,
    actualHours,
    roundedHours,
    adjustedHours,
    billedHours,
    unbillableHours,
    baseRevenue,
    billedRevenue,
    companies: companyResults,
  };
}

// ============================================================================
// HELPER: BUILD INPUTS FROM RAW DATA
// ============================================================================

/**
 * Build billing inputs from timesheet entries and billing configuration.
 * This is the bridge between raw database data and the unified billing functions.
 */
export interface BuildBillingInputsParams {
  entries: Array<{
    project_id: string | null;
    project_name: string;
    client_id: string | null;
    task_name: string | null;
    total_minutes: number;
  }>;
  /** Function to get billing config for a project (ID-only lookup) */
  getBillingConfig: (projectId: string) => ProjectBillingConfig;
  /** Function to get canonical company name (ID-only lookup) */
  getCompanyName: (clientId: string) => string;
}

export function buildBillingInputs(params: BuildBillingInputsParams): CompanyInput[] {
  const { entries, getBillingConfig, getCompanyName } = params;

  // Group entries: companyId -> projectId -> tasks
  // Use IDs as keys, not names
  const companyMap = new Map<string, {
    companyName: string;
    projectMap: Map<string, { projectId: string; projectName: string; tasks: Map<string, number> }>;
  }>();

  for (const entry of entries) {
    const companyId = entry.client_id || '';
    const companyName = getCompanyName(companyId);
    const projectId = entry.project_id || '';
    const projectName = entry.project_name;
    const taskName = entry.task_name || 'No Task';

    if (!companyMap.has(companyId)) {
      companyMap.set(companyId, { companyName, projectMap: new Map() });
    }
    const companyData = companyMap.get(companyId)!;

    if (!companyData.projectMap.has(projectId)) {
      companyData.projectMap.set(projectId, { projectId, projectName, tasks: new Map() });
    }
    const projectData = companyData.projectMap.get(projectId)!;

    projectData.tasks.set(taskName, (projectData.tasks.get(taskName) || 0) + entry.total_minutes);
  }

  // Convert to CompanyInput[]
  const companies: CompanyInput[] = [];

  for (const [companyId, companyData] of companyMap) {
    const projects: ProjectInput[] = [];

    for (const [projectId, projectData] of companyData.projectMap) {
      const tasks: TaskInput[] = Array.from(projectData.tasks.entries()).map(
        ([taskName, totalMinutes]) => ({ taskName, totalMinutes })
      );

      const billingConfig = getBillingConfig(projectId);

      projects.push({
        projectId: projectId || null,
        projectName: projectData.projectName,
        tasks,
        billingConfig,
      });
    }

    companies.push({
      companyId,
      companyName: companyData.companyName,
      projects,
    });
  }

  return companies;
}
