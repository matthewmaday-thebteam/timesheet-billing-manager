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
      const { data, error: rpcError } = await supabase.rpc('admin_list_users');
      if (rpcError) throw rpcError;
      setUsers(data || []);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to fetch users';
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
      const { data, error: rpcError } = await supabase.rpc('admin_create_user', {
        p_email: params.email,
        p_password: params.password || null,
        p_display_name: params.display_name || null,
        p_role: params.role || 'admin',
        p_send_invite: params.send_invite ?? true,
      });

      if (rpcError) throw rpcError;

      // Refresh the user list
      await fetchUsers();

      return data as CreateUserResult;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to create user';
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
      const message = e instanceof Error ? e.message : 'Failed to update user role';
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
      const message = e instanceof Error ? e.message : 'Failed to delete user';
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
      const message = e instanceof Error ? e.message : 'Failed to send password reset email';
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
