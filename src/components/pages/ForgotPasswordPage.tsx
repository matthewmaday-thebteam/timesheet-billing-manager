import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../Button';
import { Input } from '../Input';
import { Card } from '../Card';
import { Spinner } from '../Spinner';

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
    <div className="min-h-screen bg-vercel-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-vercel-gray-600">Reset Password</h1>
          <p className="text-sm text-vercel-gray-400 mt-2">
            Enter your email to receive a password reset link
          </p>
        </div>

        {/* Card */}
        <Card variant="elevated" padding="lg">
          {success ? (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 mx-auto bg-success-light rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-vercel-gray-600">Check your email</h3>
                <p className="text-sm text-vercel-gray-400 mt-2">
                  We've sent a password reset link to <span className="font-medium">{email}</span>
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={onBackToLogin}
                className="w-full"
              >
                Back to Sign In
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Error Message */}
              {error && (
                <div className="p-3 bg-error-light border border-error rounded-lg">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm text-error">{error}</span>
                  </div>
                </div>
              )}

              {/* Email Field */}
              <Input
                label="Email Address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                autoFocus
              />

              {/* Submit Button */}
              <Button
                type="submit"
                variant="primary"
                disabled={isLoading}
                className="w-full"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner size="sm" color="white" />
                    Sending...
                  </span>
                ) : (
                  'Send Reset Link'
                )}
              </Button>

              {/* Back to Login */}
              <Button
                type="button"
                variant="secondary"
                onClick={onBackToLogin}
                className="w-full"
              >
                Back to Sign In
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
