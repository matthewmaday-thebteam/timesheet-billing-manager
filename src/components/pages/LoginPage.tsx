import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

interface LoginPageProps {
  onForgotPassword: () => void;
}

export function LoginPage({ onForgotPassword }: LoginPageProps) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const { error } = await signIn(email, password);

      if (error) {
        setError(error.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-[#000000]">Timesheet Manager</h1>
          <p className="text-sm text-[#666666] mt-2">Sign in to your account</p>
        </div>

        {/* Login Card */}
        <div className="bg-[#FFFFFF] rounded-xl border border-[#EAEAEA] p-8 shadow-sm">
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

            {/* Email Field */}
            <div>
              <label className="block text-[12px] font-medium text-[#666666] uppercase tracking-wider mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#EAEAEA] rounded-md text-sm text-[#000000] placeholder-[#888888] focus:ring-1 focus:ring-black focus:border-[#000000] focus:outline-none transition-colors duration-200 ease-out"
                placeholder="you@example.com"
                required
                autoComplete="email"
                autoFocus
              />
            </div>

            {/* Password Field */}
            <div>
              <label className="block text-[12px] font-medium text-[#666666] uppercase tracking-wider mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#EAEAEA] rounded-md text-sm text-[#000000] placeholder-[#888888] focus:ring-1 focus:ring-black focus:border-[#000000] focus:outline-none transition-colors duration-200 ease-out"
                placeholder="Enter your password"
                required
                autoComplete="current-password"
              />
            </div>

            {/* Forgot Password Link */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onForgotPassword}
                className="text-sm text-[#666666] hover:text-[#000000] transition-colors"
              >
                Forgot password?
              </button>
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
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        {/* Footer Note */}
        <p className="text-center text-[12px] text-[#888888] mt-6">
          Contact your administrator to create an account
        </p>
      </div>
    </div>
  );
}
