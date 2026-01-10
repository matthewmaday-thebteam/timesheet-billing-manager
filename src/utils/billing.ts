import type { ProjectSummary } from '../types';

export interface ProjectRate {
  projectName: string;
  hourlyRate: number;
}

// Default billing rates per project
const DEFAULT_RATES: Record<string, number> = {
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
 * Get all billing rates from localStorage, merged with defaults
 */
export function getBillingRates(): Record<string, number> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults (stored rates take precedence)
      return { ...DEFAULT_RATES, ...parsed };
    }
  } catch (e) {
    console.error('Error reading billing rates:', e);
  }
  return { ...DEFAULT_RATES };
}

/**
 * Save billing rates to localStorage
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
 */
export function getProjectRate(projectName: string): number {
  const rates = getBillingRates();
  return rates[projectName] ?? 0;
}

/**
 * Set the hourly rate for a specific project
 */
export function setProjectRate(projectName: string, rate: number): void {
  const rates = getBillingRates();
  rates[projectName] = rate;
  saveBillingRates(rates);
}

/**
 * Calculate revenue for a single project
 */
export function calculateProjectRevenue(project: ProjectSummary, rates: Record<string, number>): number {
  const hours = project.totalMinutes / 60;
  const rate = rates[project.projectName] ?? 0;
  return hours * rate;
}

/**
 * Calculate total revenue across all projects
 */
export function calculateTotalRevenue(projects: ProjectSummary[], rates: Record<string, number>): number {
  return projects.reduce((total, project) => {
    return total + calculateProjectRevenue(project, rates);
  }, 0);
}

/**
 * Get project rates as an array (for table display)
 * Includes all projects from data + any stored rates
 */
export function getProjectRatesArray(projects: ProjectSummary[]): ProjectRate[] {
  const rates = getBillingRates();

  // Get all unique project names (from data + stored rates)
  const projectNames = new Set<string>();
  projects.forEach(p => projectNames.add(p.projectName));
  Object.keys(rates).forEach(name => projectNames.add(name));

  return Array.from(projectNames)
    .sort()
    .map(projectName => ({
      projectName,
      hourlyRate: rates[projectName] ?? 0,
    }));
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
