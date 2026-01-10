import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { BulgarianHoliday, HolidayFormData } from '../types';

interface UseHolidaysResult {
  holidays: BulgarianHoliday[];
  loading: boolean;
  error: string | null;
  selectedYear: number;
  setSelectedYear: (year: number) => void;
  addHoliday: (data: HolidayFormData) => Promise<boolean>;
  updateHoliday: (id: string, data: HolidayFormData) => Promise<boolean>;
  deleteHoliday: (id: string) => Promise<boolean>;
  syncYear: (year: number) => Promise<{ success: boolean; added: number }>;
  refetch: () => void;
  isOperating: boolean;
}

export function useHolidays(): UseHolidaysResult {
  const [holidays, setHolidays] = useState<BulgarianHoliday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [isOperating, setIsOperating] = useState(false);

  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('bulgarian_holidays')
        .select('*')
        .eq('year', selectedYear)
        .order('holiday_date', { ascending: true });

      if (queryError) {
        throw new Error(queryError.message);
      }

      setHolidays(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch holidays');
    } finally {
      setLoading(false);
    }
  }, [selectedYear]);

  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  const addHoliday = useCallback(async (data: HolidayFormData): Promise<boolean> => {
    setIsOperating(true);
    setError(null);

    try {
      const holidayDate = new Date(data.holiday_date);
      const year = holidayDate.getFullYear();

      const { error: insertError } = await supabase
        .from('bulgarian_holidays')
        .insert({
          holiday_name: data.holiday_name,
          holiday_date: data.holiday_date,
          is_system_generated: false,
          year,
        });

      if (insertError) {
        throw new Error(insertError.message);
      }

      await fetchHolidays();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add holiday');
      return false;
    } finally {
      setIsOperating(false);
    }
  }, [fetchHolidays]);

  const updateHoliday = useCallback(async (id: string, data: HolidayFormData): Promise<boolean> => {
    setIsOperating(true);
    setError(null);

    try {
      const holidayDate = new Date(data.holiday_date);
      const year = holidayDate.getFullYear();

      const { error: updateError } = await supabase
        .from('bulgarian_holidays')
        .update({
          holiday_name: data.holiday_name,
          holiday_date: data.holiday_date,
          year,
          is_system_generated: false, // Mark as manual edit
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      await fetchHolidays();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update holiday');
      return false;
    } finally {
      setIsOperating(false);
    }
  }, [fetchHolidays]);

  const deleteHoliday = useCallback(async (id: string): Promise<boolean> => {
    setIsOperating(true);
    setError(null);

    try {
      const { error: deleteError } = await supabase
        .from('bulgarian_holidays')
        .delete()
        .eq('id', id);

      if (deleteError) {
        throw new Error(deleteError.message);
      }

      await fetchHolidays();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete holiday');
      return false;
    } finally {
      setIsOperating(false);
    }
  }, [fetchHolidays]);

  const syncYear = useCallback(async (year: number): Promise<{ success: boolean; added: number }> => {
    setIsOperating(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase
        .rpc('sync_bulgarian_holidays', { target_year: year });

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      await fetchHolidays();
      return { success: true, added: data || 0 };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync holidays');
      return { success: false, added: 0 };
    } finally {
      setIsOperating(false);
    }
  }, [fetchHolidays]);

  return {
    holidays,
    loading,
    error,
    selectedYear,
    setSelectedYear,
    addHoliday,
    updateHoliday,
    deleteHoliday,
    syncYear,
    refetch: fetchHolidays,
    isOperating,
  };
}
