import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { startOfMonth, endOfMonth } from 'date-fns';
import type { DateRange } from '../types';
import type { RangeSelectorMode } from '../components/atoms/RangeSelector';

const STORAGE_KEY = 'dateFilter';

/** Clear the persisted date filter from sessionStorage (call on login/logout) */
export function clearDateFilterStorage() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

interface DateFilterState {
  dateRange: DateRange;
  mode: RangeSelectorMode;
  selectedMonth: Date;
}

interface DateFilterContextValue extends DateFilterState {
  setDateRange: (range: DateRange) => void;
  setFilter: (mode: RangeSelectorMode, selectedMonth: Date, dateRange: DateRange) => void;
}

const DateFilterContext = createContext<DateFilterContextValue | null>(null);

function loadFromSession(): DateFilterState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      dateRange: {
        start: new Date(parsed.start),
        end: new Date(parsed.end),
      },
      mode: parsed.mode as RangeSelectorMode,
      selectedMonth: new Date(parsed.selectedMonth),
    };
  } catch {
    return null;
  }
}

function saveToSession(state: DateFilterState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      start: state.dateRange.start.toISOString(),
      end: state.dateRange.end.toISOString(),
      mode: state.mode,
      selectedMonth: state.selectedMonth.toISOString(),
    }));
  } catch {
    // Ignore storage errors
  }
}

function getDefaultState(): DateFilterState {
  const now = new Date();
  return {
    dateRange: { start: startOfMonth(now), end: endOfMonth(now) },
    mode: 'month',
    selectedMonth: now,
  };
}

export function DateFilterProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DateFilterState>(() => loadFromSession() || getDefaultState());

  const setDateRange = useCallback((range: DateRange) => {
    setState(prev => {
      const next = { ...prev, dateRange: range };
      saveToSession(next);
      return next;
    });
  }, []);

  const setFilter = useCallback((mode: RangeSelectorMode, selectedMonth: Date, dateRange: DateRange) => {
    const next: DateFilterState = { mode, selectedMonth, dateRange };
    setState(next);
    saveToSession(next);
  }, []);

  return (
    <DateFilterContext.Provider value={{ ...state, setDateRange, setFilter }}>
      {children}
    </DateFilterContext.Provider>
  );
}

export function useDateFilter(): DateFilterContextValue {
  const ctx = useContext(DateFilterContext);
  if (!ctx) {
    throw new Error('useDateFilter must be used within a DateFilterProvider');
  }
  return ctx;
}
