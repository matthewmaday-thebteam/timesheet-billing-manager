import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type {
  ApiKey,
  CreateApiKeyParams,
  CreateApiKeyResult,
  RevokeApiKeyResult,
} from '../types';

function getErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    typeof (e as { message: unknown }).message === 'string'
  ) {
    return (e as { message: string }).message;
  }
  return fallback;
}

interface UseAdminApiKeysReturn {
  apiKeys: ApiKey[];
  loading: boolean;
  error: string | null;
  activeCount: number;
  revokedCount: number;
  fetchApiKeys: () => Promise<void>;
  createApiKey: (params: CreateApiKeyParams) => Promise<CreateApiKeyResult>;
  revokeApiKey: (keyId: string) => Promise<RevokeApiKeyResult>;
  clearError: () => void;
  isOperating: boolean;
}

/**
 * Admin hook for managing API keys via the `mcp_api` Postgres schema.
 *
 * NOTE: Unlike `useAdminUsers` (which calls public-schema RPCs), this hook
 * targets the `mcp_api` schema using `supabase.schema('mcp_api').rpc(...)`.
 * Admin authorization is enforced server-side inside each RPC.
 */
export function useAdminApiKeys(): UseAdminApiKeysReturn {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOperating, setIsOperating] = useState(false);

  const activeCount = apiKeys.filter((k) => k.status === 'active').length;
  const revokedCount = apiKeys.filter((k) => k.status === 'revoked').length;

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const fetchApiKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated. Please log in again.');
      }

      const { data, error: rpcError } = await supabase
        .schema('mcp_api')
        .rpc('admin_list_api_keys');

      if (rpcError) {
        console.error('RPC Error:', rpcError);
        throw new Error(rpcError.message || 'Failed to fetch API keys');
      }
      setApiKeys((data as ApiKey[] | null) ?? []);
    } catch (e) {
      const message = getErrorMessage(e, 'Failed to fetch API keys');
      console.error('fetchApiKeys error:', e);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch API keys on mount
  useEffect(() => {
    fetchApiKeys();
  }, [fetchApiKeys]);

  const createApiKey = async (
    params: CreateApiKeyParams
  ): Promise<CreateApiKeyResult> => {
    setIsOperating(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase
        .schema('mcp_api')
        .rpc('admin_create_api_key', {
          p_name: params.name,
          p_description: params.description ?? null,
        });

      if (rpcError) throw rpcError;
      if (!data) throw new Error('No data returned from admin_create_api_key');

      // Refresh list so the new key appears in the table
      await fetchApiKeys();

      return data as CreateApiKeyResult;
    } catch (e) {
      const message = getErrorMessage(e, 'Failed to create API key');
      setError(message);
      throw new Error(message);
    } finally {
      setIsOperating(false);
    }
  };

  const revokeApiKey = async (keyId: string): Promise<RevokeApiKeyResult> => {
    setIsOperating(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase
        .schema('mcp_api')
        .rpc('admin_revoke_api_key', { p_key_id: keyId });

      if (rpcError) throw rpcError;

      // Refresh list to reflect status change
      await fetchApiKeys();

      return data as RevokeApiKeyResult;
    } catch (e) {
      const message = getErrorMessage(e, 'Failed to revoke API key');
      setError(message);
      throw new Error(message);
    } finally {
      setIsOperating(false);
    }
  };

  return {
    apiKeys,
    loading,
    error,
    activeCount,
    revokedCount,
    fetchApiKeys,
    createApiKey,
    revokeApiKey,
    clearError,
    isOperating,
  };
}
