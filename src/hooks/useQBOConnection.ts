/**
 * useQBOConnection - QuickBooks Online OAuth connection hook
 *
 * Manages QBO connection status, initiates OAuth flow via the
 * qbo-auth-start Edge Function, handles the return redirect,
 * and provides disconnect functionality.
 *
 * Security: Only selects realm_id, expires_at, refresh_expires_at
 * from qbo_oauth_tokens — NEVER exposes access_token or refresh_token
 * to the client.
 *
 * @official 2026-03-29
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { QBOConnectionStatus } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface UseQBOConnectionResult {
  /** Whether a valid QBO connection exists */
  isConnected: boolean;
  /** QBO company realm ID */
  realmId: string | null;
  /** Access token expiration timestamp */
  expiresAt: string | null;
  /** Refresh token expiration timestamp */
  refreshExpiresAt: string | null;
  /** Initial data loading */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Initiate OAuth flow — redirects the browser to Intuit */
  startConnection: () => Promise<void>;
  /** Remove the stored QBO connection */
  disconnect: () => Promise<void>;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Extract meaningful error from a Supabase Edge Function error response.
 * Mirrors the pattern from useEOMReports.
 */
async function extractFnError(fnError: { message?: string; context?: Response }): Promise<string> {
  if (fnError.context && typeof fnError.context.json === 'function') {
    try {
      const body = await fnError.context.json();
      return body?.error || body?.message || fnError.message || 'Unknown error';
    } catch { /* fall through */ }
  }
  return fnError.message || 'Unknown error';
}

/**
 * Remove specified query parameters from the current URL without a page reload.
 */
function cleanUrlParams(params: string[]): void {
  const url = new URL(window.location.href);
  let changed = false;
  for (const param of params) {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      changed = true;
    }
  }
  if (changed) {
    window.history.replaceState({}, '', url.toString());
  }
}

// ============================================================================
// HOOK
// ============================================================================

export function useQBOConnection(): UseQBOConnectionResult {
  const [status, setStatus] = useState<QBOConnectionStatus>({
    isConnected: false,
    realmId: null,
    expiresAt: null,
    refreshExpiresAt: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Fetch connection status ----
  const fetchStatus = useCallback(async (isInitial = false) => {
    if (isInitial) setIsLoading(true);
    setError(null);

    try {
      // Select ONLY safe columns — never access_token or refresh_token
      const { data, error: queryError } = await supabase
        .from('qbo_oauth_tokens')
        .select('realm_id, expires_at, refresh_expires_at')
        .limit(1)
        .maybeSingle();

      if (queryError) throw queryError;

      if (data && data.refresh_expires_at) {
        // Check if the refresh token is still valid (connection is usable)
        const refreshExpiry = new Date(data.refresh_expires_at);
        const isValid = refreshExpiry > new Date();

        setStatus({
          isConnected: isValid,
          realmId: data.realm_id,
          expiresAt: data.expires_at,
          refreshExpiresAt: data.refresh_expires_at,
        });
      } else {
        setStatus({
          isConnected: false,
          realmId: null,
          expiresAt: null,
          refreshExpiresAt: null,
        });
      }
    } catch (err) {
      console.error('Error fetching QBO connection status:', err);
      setError(err instanceof Error ? err.message : 'Failed to check QBO connection');
      setStatus({
        isConnected: false,
        realmId: null,
        expiresAt: null,
        refreshExpiresAt: null,
      });
    } finally {
      if (isInitial) setIsLoading(false);
    }
  }, []);

  // ---- Handle OAuth return on mount ----
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get('qbo_connected') === 'true') {
      // Successful OAuth return — refetch status and clean URL
      fetchStatus(true).then(() => {
        cleanUrlParams(['qbo_connected']);
      });
    } else if (params.get('qbo_error') === 'true') {
      // OAuth error return — set error and clean URL
      const message = params.get('qbo_error_message') || 'QuickBooks connection failed';
      setError(decodeURIComponent(message));
      setIsLoading(false);
      cleanUrlParams(['qbo_error', 'qbo_error_message']);
    } else {
      // Normal mount — fetch status
      fetchStatus(true);
    }
  }, [fetchStatus]);

  // ---- Start OAuth flow ----
  const startConnection = useCallback(async () => {
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('qbo-auth-start', {
        body: {},
      });

      if (fnError) throw new Error(await extractFnError(fnError));

      const authUrl = data?.authorizationUrl || data?.authorization_url;
      if (!authUrl) {
        throw new Error('No authorization URL returned from server');
      }

      // Redirect browser to Intuit's OAuth consent screen
      window.location.href = authUrl;
    } catch (err) {
      console.error('Error starting QBO connection:', err);
      setError(err instanceof Error ? err.message : 'Failed to start QuickBooks connection');
    }
  }, []);

  // ---- Disconnect ----
  const disconnect = useCallback(async () => {
    setError(null);

    try {
      const { error: deleteError } = await supabase
        .from('qbo_oauth_tokens')
        .delete()
        .neq('realm_id', '');  // Delete all rows (neq on a non-null column matches all)

      if (deleteError) throw deleteError;

      setStatus({
        isConnected: false,
        realmId: null,
        expiresAt: null,
        refreshExpiresAt: null,
      });
    } catch (err) {
      console.error('Error disconnecting QBO:', err);
      setError(err instanceof Error ? err.message : 'Failed to disconnect QuickBooks');
    }
  }, []);

  return {
    isConnected: status.isConnected,
    realmId: status.realmId,
    expiresAt: status.expiresAt,
    refreshExpiresAt: status.refreshExpiresAt,
    isLoading,
    error,
    startConnection,
    disconnect,
  };
}

export default useQBOConnection;
