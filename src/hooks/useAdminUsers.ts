import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type {
  AppUser,
  CreateUserParams,
  CreateUserResult,
  UpdateRoleResult,
  DeleteUserResult,
  UserRole,
} from '../types';

function getErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return fallback;
}

interface UseAdminUsersReturn {
  users: AppUser[];
  loading: boolean;
  error: string | null;
  adminCount: number;
  fetchUsers: () => Promise<void>;
  createUser: (params: CreateUserParams) => Promise<CreateUserResult>;
  updateUserRole: (userId: string, role: UserRole) => Promise<UpdateRoleResult>;
  deleteUser: (userId: string) => Promise<DeleteUserResult>;
  sendPasswordResetEmail: (email: string) => Promise<boolean>;
  clearError: () => void;
  isOperating: boolean;
}

export function useAdminUsers(): UseAdminUsersReturn {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOperating, setIsOperating] = useState(false);

  const adminCount = users.filter((u) => u.role === 'admin').length;

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Check if user is authenticated
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated. Please log in again.');
      }

      const { data, error: rpcError } = await supabase.rpc('admin_list_users');
      if (rpcError) {
        console.error('RPC Error:', rpcError);
        throw new Error(rpcError.message || 'Failed to fetch users');
      }
      setUsers(data || []);
    } catch (e) {
      const message = getErrorMessage(e, 'Failed to fetch users');
      console.error('fetchUsers error:', e);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch users on mount
  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const createUser = async (params: CreateUserParams): Promise<CreateUserResult> => {
    setIsOperating(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('admin-users', {
        body: {
          email: params.email,
          password: params.password || null,
          display_name: params.display_name || null,
          role: params.role || 'admin',
          send_invite: params.send_invite ?? true,
          redirect_to: `${window.location.origin}/reset-password`,
        },
      });

      // On non-2xx, supabase-js sets both data (response body) and error (generic message)
      // Prefer the specific error from our function's response body
      if (fnError) {
        throw new Error(data?.error || fnError.message || 'Failed to create user');
      }

      // Refresh the user list
      await fetchUsers();

      return data as CreateUserResult;
    } catch (e) {
      const message = getErrorMessage(e, 'Failed to create user');
      setError(message);
      throw new Error(message);
    } finally {
      setIsOperating(false);
    }
  };

  const updateUserRole = async (
    userId: string,
    role: UserRole
  ): Promise<UpdateRoleResult> => {
    setIsOperating(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_update_user_role', {
        p_user_id: userId,
        p_new_role: role,
      });

      if (rpcError) throw rpcError;

      // Refresh the user list
      await fetchUsers();

      return data as UpdateRoleResult;
    } catch (e) {
      const message = getErrorMessage(e, 'Failed to update user role');
      setError(message);
      throw new Error(message);
    } finally {
      setIsOperating(false);
    }
  };

  const deleteUser = async (userId: string): Promise<DeleteUserResult> => {
    setIsOperating(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_delete_user', {
        p_user_id: userId,
      });

      if (rpcError) throw rpcError;

      // Refresh the user list
      await fetchUsers();

      return data as DeleteUserResult;
    } catch (e) {
      const message = getErrorMessage(e, 'Failed to delete user');
      setError(message);
      throw new Error(message);
    } finally {
      setIsOperating(false);
    }
  };

  const sendPasswordResetEmail = async (email: string): Promise<boolean> => {
    setIsOperating(true);
    setError(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (resetError) throw resetError;

      return true;
    } catch (e) {
      const message = getErrorMessage(e, 'Failed to send password reset email');
      setError(message);
      return false;
    } finally {
      setIsOperating(false);
    }
  };

  return {
    users,
    loading,
    error,
    adminCount,
    fetchUsers,
    createUser,
    updateUserRole,
    deleteUser,
    sendPasswordResetEmail,
    clearError,
    isOperating,
  };
}
