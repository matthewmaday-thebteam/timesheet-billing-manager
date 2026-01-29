import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../Button';
import { Input } from '../Input';
import { Card } from '../Card';
import { Spinner } from '../Spinner';
import { Alert } from '../Alert';

interface LoginPageProps {
  onForgotPassword: () => void;
  authError?: string | null;
}

export function LoginPage({ onForgotPassword, authError }: LoginPageProps) {
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
    <div className="min-h-screen bg-vercel-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Login Card */}
        <Card variant="elevated" padding="lg">
          {/* Logo/Title */}
          <div className="text-center mb-8">
            <img
              src="/logo.svg"
              alt="The B Team Logo"
              width={130}
              height={130}
              className="mx-auto mb-4"
            />
            <h1 className="text-2xl font-semibold text-vercel-gray-600">Manifest</h1>
            <p className="text-sm text-vercel-gray-400 mt-2 italic">See the Unseeable. Know the Unknowable.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Auth Error (e.g. expired invite link) */}
            {authError && (
              <Alert message={authError} variant="brand" />
            )}

            {/* Error Message */}
            {error && <Alert message={error} variant="brand" />}

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

            {/* Password Field */}
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              autoComplete="current-password"
            />

            {/* Forgot Password Link */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onForgotPassword}
                className="text-sm text-bteam-brand hover:text-bteam-brand/80 transition-colors"
              >
                Forgot password?
              </button>
            </div>

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
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>
        </Card>

        {/* Footer Note */}
        <p className="text-center text-xs text-vercel-gray-300 mt-6">
          <a
            href="mailto:info@yourbteam.com?subject=Trouble%20Creating%20An%20Account"
            className="text-bteam-brand font-bold hover:text-bteam-brand/80 transition-colors"
          >
            Contact
          </a>
          {' '}your administrator to create an account
        </p>
      </div>
    </div>
  );
}
