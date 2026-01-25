/**
 * Billing Diagnostics Module
 *
 * Validates billing calculations by comparing raw source data
 * against processed billing results.
 */

// Types
export type {
  DiagnosticSource,
  NormalizedEntry,
  ValidationStatus,
  ValidationCheck,
  ProjectValidationResult,
  ValidationSummary,
  ValidationReport,
  ProjectEntryGroup,
  RawClockifyEntry,
  RawClockifyExport,
  RawClickUpEntry,
  RawClickUpExport,
  BillingConfigLookup,
  ValidationOptions,
} from './types';

// Parsing utilities
export {
  parseClockify,
  parseClickUp,
  parseRawSource,
  groupEntriesByProject,
  groupEntriesByTask,
  filterEntriesByDateRange,
  filterEntriesByMonth,
  getUniqueMonths,
} from './parseRawSources';

// Validation utilities
export {
  runValidation,
  validateAgainstExpected,
  formatValidationCheck,
  formatHoursDisplay,
  formatMinutesDisplay,
  formatCurrencyDisplay,
  getStatusColorClass,
  getStatusIcon,
} from './validateBilling';
