import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

interface ForgotPasswordPageProps {
  onBackToLogin: () => void;
}

export function ForgotPasswordPage({ onBackToLogin }: ForgotPasswordPageProps) {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setIsLoading(true);

    const { error } = await resetPassword(email);

    if (error) {
      setError(error.message);
    } else {
      setSuccess(true);
    }
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-[#000000]">Reset Password</h1>
          <p className="text-sm text-[#666666] mt-2">
            Enter your email to receive a password reset link
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
                <h3 className="text-sm font-semibold text-[#000000]">Check your email</h3>
                <p className="text-sm text-[#666666] mt-2">
                  We've sent a password reset link to <span className="font-medium">{email}</span>
                </p>
              </div>
              <button
                onClick={onBackToLogin}
                className="w-full px-4 py-2.5 text-sm font-medium text-[#666666] bg-[#FFFFFF] border border-[#EAEAEA] rounded-md hover:bg-[#FAFAFA] transition-colors duration-200 ease-out focus:outline-none focus:ring-1 focus:ring-black"
              >
                Back to Sign In
              </button>
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
                    Sending...
                  </span>
                ) : (
                  'Send Reset Link'
                )}
              </button>

              {/* Back to Login */}
              <button
                type="button"
                onClick={onBackToLogin}
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
