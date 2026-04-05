/**
 * Chart Configuration Constants
 *
 * Centralized configuration for dashboard charts.
 * These values are used across chart components and data transformations.
 *
 * @official 2026-01-11
 * @category Config
 */

/**
 * Target ratio for revenue (1.8x of budget)
 * Annual target = Annual budget * 1.8 = $1.8M
 */
export const TARGET_RATIO = 1.8;

/**
 * Annual budget baseline in dollars
 * Monthly budget = $1M / 12 = ~$83,333.33
 * Monthly target = $1.8M / 12 = $150,000
 */
export const ANNUAL_BUDGET = 1_000_000;

/**
 * Maximum number of resources to show in pie chart
 * Additional resources are grouped into "Other"
 */
export const TOP_N_RESOURCES = 5;

/**
 * Default chart height in pixels
 */
export const CHART_HEIGHT = 250;

/**
 * Number of months to show in historical line chart
 */
export const HISTORICAL_MONTHS = 12;
