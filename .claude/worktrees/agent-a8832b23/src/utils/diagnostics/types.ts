/**
 * Billing Diagnostics Types
 *
 * Type definitions for the diagnostics system that validates
 * billing calculations against raw source data.
 */

import type { RoundingIncrement } from '../../types';

/**
 * Source of time tracking data
 */
export type DiagnosticSource = 'clockify' | 'clickup';

/**
 * Normalized time entry from either Clockify or ClickUp
 */
export interface NormalizedEntry {
  source: DiagnosticSource;
  entryId: string;
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
  taskName: string;
  userName: string;
  minutes: number;
  date: string;  // ISO date string YYYY-MM-DD
}

/**
 * Validation status for a single check
 */
export type ValidationStatus = 'pass' | 'fail' | 'warning';

/**
 * Individual validation check result
 */
export interface ValidationCheck {
  label: string;
  expected: number;
  actual: number;
  status: ValidationStatus;
  tolerance?: number;  // Optional tolerance for floating-point comparisons
}

/**
 * Project-level validation result
 */
export interface ProjectValidationResult {
  clientName: string;
  projectName: string;
  source: DiagnosticSource;

  // Source file identifiers (for debugging lookup issues)
  sourceProjectId: string;
  sourceClientId: string;

  // Whether config was found in system or using defaults
  matchedInSystem: boolean;
  matchedProjectName: string | null;

  // Raw data from source files
  rawMinutes: number;
  actualHours: number;

  // Billing configuration
  rounding: RoundingIncrement;
  rate: number;
  minimumHours: number | null;
  maximumHours: number | null;
  carryoverEnabled: boolean;
  carryoverIn: number;
  isActive: boolean;

  // Calculated values
  roundedHours: number;
  adjustedHours: number;  // roundedHours + carryoverIn
  baseRevenue: number;
  billedHours: number;
  billedRevenue: number;

  // Validation checks
  checks: {
    roundedHours: ValidationCheck;
    baseRevenue: ValidationCheck;
    billedRevenue: ValidationCheck;
  };

  // Overall status
  allPassed: boolean;
}

/**
 * Summary statistics for the validation report
 */
export interface ValidationSummary {
  totalProjects: number;
  clockifyProjects: number;
  clickupProjects: number;

  // Pass counts
  roundedHoursPassed: number;
  baseRevenuePassed: number;
  billedRevenuePassed: number;

  // Totals
  totalBilledRevenue: number;

  // Overall status
  allPassed: boolean;
}

/**
 * Complete validation report
 */
export interface ValidationReport {
  generatedAt: string;  // ISO timestamp
  projects: ProjectValidationResult[];
  summary: ValidationSummary;
}

/**
 * Grouped entries by project for validation
 */
export interface ProjectEntryGroup {
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  source: DiagnosticSource;
  entries: NormalizedEntry[];
  totalMinutes: number;
}

/**
 * Raw Clockify time entry from JSON export
 */
export interface RawClockifyEntry {
  _id: string;
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
  description: string;
  userName: string;
  timeInterval: {
    start: string;
    end: string;
    duration: number;  // seconds
  };
}

/**
 * Raw Clockify export format
 */
export interface RawClockifyExport {
  timeentries: RawClockifyEntry[];
}

/**
 * Raw ClickUp time entry from JSON export
 */
export interface RawClickUpEntry {
  id: string;
  task_location: {
    space_id: string;
    folder_id: string;
    list_id: string;
  };
  task: {
    id: string;
    name: string;
  } | null;
  user: {
    id: number;
    username: string;
    email: string;
  };
  duration: string;  // milliseconds as string
  start: string;     // timestamp as string
}

/**
 * Raw ClickUp export format
 */
export interface RawClickUpExport {
  timeentries: RawClickUpEntry[];
  spaceLookup: Record<string, string>;   // space_id -> space_name
  folderLookup: Record<string, string>;  // folder_id -> folder_name
}

/**
 * Billing configuration lookup function type
 */
export interface BillingConfigLookup {
  rate: number;
  rounding: RoundingIncrement;
  minimumHours: number | null;
  maximumHours: number | null;
  carryoverEnabled: boolean;
  carryoverIn: number;
  isActive: boolean;
  /** Whether this config was found in the system (false = using defaults) */
  matchedInSystem?: boolean;
  /** The project name that was matched in the system */
  matchedProjectName?: string | null;
}

/**
 * Options for running validation
 */
export interface ValidationOptions {
  /** Function to get billing config for a project (ID-only lookup) */
  getBillingConfig: (projectId: string) => BillingConfigLookup;
  /** Function to get canonical company name (ID-only lookup) */
  getCompanyName: (clientId: string) => string;
  /** Tolerance for floating-point comparisons (default: 0.01) */
  tolerance?: number;
}
