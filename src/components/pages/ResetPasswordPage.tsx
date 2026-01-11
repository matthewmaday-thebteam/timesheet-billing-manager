import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

interface ResetPasswordPageProps {
  onComplete: () => void;
}

export function ResetPasswordPage({ onComplete }: ResetPasswordPageProps) {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const validatePassword = (): boolean => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return false;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validatePassword()) {
      return;
    }

    setIsLoading(true);
    const { error } = await updatePassword(password);

    if (error) {
      setError(error.message);
      setIsLoading(false);
    } else {
      setSuccess(true);
      setTimeout(() => {
        onComplete();
      }, 2000);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-[#000000]">Set New Password</h1>
          <p className="text-sm text-[#666666] mt-2">
            Enter your new password below
          </p>
        </div>

        {/* Card */}
        <div className="bg-[#FFFFFF] rounded-xl border border-[#EAEAEA] p-8 shadow-sm">
          {success ? (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 mx-auto bg-[#F0FDF4] rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-[#166534]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#000000]">Password Updated</h3>
                <p className="text-sm text-[#666666] mt-2">
                  Your password has been successfully updated. Redirecting to sign in...
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Error Message */}
              {error && (
                <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-lg">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-[#DC2626]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm text-[#DC2626]">{error}</span>
                  </div>
                </div>
              )}

              {/* New Password Field */}
              <div>
                <label className="block text-[12px] font-medium text-[#666666] uppercase tracking-wider mb-2">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 pr-10 bg-[#FFFFFF] border border-[#EAEAEA] rounded-md text-sm text-[#000000] placeholder-[#888888] focus:ring-1 focus:ring-black focus:border-[#000000] focus:outline-none transition-colors duration-200 ease-out"
                    placeholder="Minimum 8 characters"
                    required
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#666666] hover:text-[#000000] transition-colors"
                  >
                    {showPassword ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-[#888888]">Must be at least 8 characters</p>
              </div>

              {/* Confirm Password Field */}
              <div>
                <label className="block text-[12px] font-medium text-[#666666] uppercase tracking-wider mb-2">
                  Confirm Password
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#EAEAEA] rounded-md text-sm text-[#000000] placeholder-[#888888] focus:ring-1 focus:ring-black focus:border-[#000000] focus:outline-none transition-colors duration-200 ease-out"
                  placeholder="Re-enter your password"
                  required
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full px-4 py-2.5 text-sm font-medium text-[#FFFFFF] bg-[#000000] border border-[#000000] rounded-md hover:bg-[#333333] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 ease-out focus:outline-none focus:ring-1 focus:ring-black"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Updating...
                  </span>
                ) : (
                  'Update Password'
                )}
              </button>

              {/* Back to Login */}
              <button
                type="button"
                onClick={onComplete}
                className="w-full px-4 py-2.5 text-sm font-medium text-[#666666] bg-[#FFFFFF] border border-[#EAEAEA] rounded-md hover:bg-[#FAFAFA] transition-colors duration-200 ease-out focus:outline-none focus:ring-1 focus:ring-black"
              >
                Back to Sign In
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
