/**
 * BillingSourceContext - Feature flag for billing data source.
 *
 * Controls whether the app reads billing data from:
 * - 'frontend': In-browser calculation via useUnifiedBilling (default, current behavior)
 * - 'summary': Pre-calculated data from project_monthly_summary table
 * - 'parallel': Frontend data returned, but both run and discrepancies are logged
 *
 * Persisted in localStorage so the setting survives page refreshes.
 * Default is 'frontend' for zero behavior change on deploy.
 *
 * @official 2026-02-10
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

// ============================================================================
// TYPES
// ============================================================================

export type BillingSource = 'frontend' | 'summary' | 'parallel';

interface BillingSourceContextValue {
  source: BillingSource;
  setSource: (source: BillingSource) => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STORAGE_KEY = 'billing_source';
const DEFAULT_SOURCE: BillingSource = 'frontend';
const VALID_SOURCES: BillingSource[] = ['frontend', 'summary', 'parallel'];

// ============================================================================
// CONTEXT
// ============================================================================

const BillingSourceContext = createContext<BillingSourceContextValue | null>(null);

function loadFromStorage(): BillingSource {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && VALID_SOURCES.includes(stored as BillingSource)) {
      return stored as BillingSource;
    }
  } catch {
    // Ignore storage errors
  }
  return DEFAULT_SOURCE;
}

function saveToStorage(source: BillingSource) {
  try {
    localStorage.setItem(STORAGE_KEY, source);
  } catch {
    // Ignore storage errors
  }
}

// ============================================================================
// PROVIDER
// ============================================================================

export function BillingSourceProvider({ children }: { children: ReactNode }) {
  const [source, setSourceState] = useState<BillingSource>(loadFromStorage);

  const setSource = useCallback((newSource: BillingSource) => {
    setSourceState(newSource);
    saveToStorage(newSource);
  }, []);

  return (
    <BillingSourceContext.Provider value={{ source, setSource }}>
      {children}
    </BillingSourceContext.Provider>
  );
}

// ============================================================================
// HOOK
// ============================================================================

export function useBillingSource(): BillingSourceContextValue {
  const ctx = useContext(BillingSourceContext);
  if (!ctx) {
    throw new Error('useBillingSource must be used within a BillingSourceProvider');
  }
  return ctx;
}
