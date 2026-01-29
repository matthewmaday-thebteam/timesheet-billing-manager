import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// Capture the URL hash at module load time, before the Supabase client clears it.
// Invite links arrive with type=invite (or type=signup) in the hash fragment.
// We treat these the same as password recovery so the user is forced to set a password.
let _initialHashType: string | null = (() => {
  try {
    const hash = window.location.hash.substring(1); // strip leading #
    const params = new URLSearchParams(hash);
    return params.get('type'); // e.g. 'invite', 'signup', 'recovery'
  } catch {
    return null;
  }
})();

// Persist recovery state in sessionStorage so it survives page refreshes.
// Without this, an invited user can bypass the "Set Password" screen by refreshing
// the page — the Supabase session is valid (stored in localStorage) but the
// React-only isRecoverySession flag resets to false on remount.
const RECOVERY_SESSION_KEY = 'isRecoverySession';

function persistRecoveryFlag(value: boolean) {
  if (value) {
    sessionStorage.setItem(RECOVERY_SESSION_KEY, 'true');
  } else {
    sessionStorage.removeItem(RECOVERY_SESSION_KEY);
  }
}

function readPersistedRecoveryFlag(): boolean {
  return sessionStorage.getItem(RECOVERY_SESSION_KEY) === 'true';
}

// Inactivity timeout in milliseconds (15 minutes)
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;

interface ProfileUpdateData {
  firstName?: string;
  lastName?: string;
  avatarUrl?: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isRecoverySession: boolean;
  clearRecoverySession: () => void;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: Error | null }>;
  updateProfile: (data: ProfileUpdateData) => Promise<{ error: Error | null }>;
  updateEmail: (newEmail: string) => Promise<{ error: Error | null; emailConfirmationRequired: boolean }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRecoverySession, setIsRecoverySession] = useState(readPersistedRecoveryFlag);
  const inactivityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sign out function (defined early for use in timeout)
  const performSignOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  // Reset inactivity timer
  const resetInactivityTimer = useCallback(() => {
    // Clear existing timeout
    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
    }

    // Only set timeout if user is logged in
    if (user) {
      inactivityTimeoutRef.current = setTimeout(() => {
        console.log('Session timed out due to inactivity');
        performSignOut();
      }, INACTIVITY_TIMEOUT_MS);
    }
  }, [user, performSignOut]);

  // Set up inactivity tracking
  useEffect(() => {
    if (!user) {
      // Clear timeout when logged out
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
        inactivityTimeoutRef.current = null;
      }
      return;
    }

    // Events that indicate user activity
    const activityEvents = [
      'mousedown',
      'mousemove',
      'keydown',
      'scroll',
      'touchstart',
      'click',
    ];

    // Throttle activity detection to avoid excessive timer resets
    let lastActivity = Date.now();
    const throttleMs = 1000; // Only reset timer once per second max

    const handleActivity = () => {
      const now = Date.now();
      if (now - lastActivity >= throttleMs) {
        lastActivity = now;
        resetInactivityTimer();
      }
    };

    // Add event listeners
    activityEvents.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    // Start initial timer
    resetInactivityTimer();

    // Cleanup
    return () => {
      activityEvents.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }
    };
  }, [user, resetInactivityTimer]);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);

        // Detect password recovery flow
        if (event === 'PASSWORD_RECOVERY') {
          setIsRecoverySession(true);
          persistRecoveryFlag(true);
        }

        // Detect invite acceptance — force the user to set a password.
        // Supabase fires SIGNED_IN (not PASSWORD_RECOVERY) for invite links,
        // so we check the URL hash type we captured at module load time.
        if (event === 'SIGNED_IN' && (_initialHashType === 'invite' || _initialHashType === 'signup')) {
          setIsRecoverySession(true);
          persistRecoveryFlag(true);
          _initialHashType = null; // consume so subsequent sign-ins don't re-trigger
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error: error ? new Error(error.message) : null };
  };

  const signOut = async () => {
    persistRecoveryFlag(false);
    await supabase.auth.signOut();
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error: error ? new Error(error.message) : null };
  };

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (!error) {
      setIsRecoverySession(false);
      persistRecoveryFlag(false);
    }
    return { error: error ? new Error(error.message) : null };
  };

  const updateProfile = async (data: ProfileUpdateData) => {
    const { error } = await supabase.auth.updateUser({
      data: {
        first_name: data.firstName,
        last_name: data.lastName,
        avatar_url: data.avatarUrl,
      },
    });
    return { error: error ? new Error(error.message) : null };
  };

  const updateEmail = async (newEmail: string) => {
    const { error } = await supabase.auth.updateUser({
      email: newEmail,
    });
    // Supabase requires email confirmation by default
    return {
      error: error ? new Error(error.message) : null,
      emailConfirmationRequired: !error,
    };
  };

  const clearRecoverySession = useCallback(() => {
    setIsRecoverySession(false);
    persistRecoveryFlag(false);
    _initialHashType = null;
  }, []);

  const value = {
    user,
    session,
    loading,
    isRecoverySession,
    clearRecoverySession,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    updateProfile,
    updateEmail,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- Context + hook pattern is intentional
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
