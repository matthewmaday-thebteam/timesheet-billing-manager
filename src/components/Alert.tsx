/**
 * Alert - Official Design System Atom
 *
 * Subtle alert box for displaying messages (errors, info, warnings).
 *
 * @official 2026-01-12
 * @category Atom
 *
 * Token Usage (default):
 * - Background: vercel-gray-50
 * - Border: vercel-gray-200
 * - Text/Icon: vercel-gray-200
 *
 * Token Usage (warning):
 * - Background: warning-light
 * - Border: warning
 * - Text/Icon: warning
 */

interface AlertProps {
  /** The message to display */
  message: string;
  /** Optional icon type */
  icon?: 'error' | 'info' | 'warning';
  /** Visual variant */
  variant?: 'default' | 'warning' | 'error';
}

export function Alert({ message, icon = 'error', variant = 'default' }: AlertProps) {
  const icons = {
    error: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    ),
    info: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    ),
    warning: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    ),
  };

  const containerClasses = {
    default: 'bg-vercel-gray-50 border-vercel-gray-200',
    warning: 'bg-warning-light border-warning',
    error: 'bg-error-light border-error',
  }[variant];

  const iconClasses = {
    default: 'text-vercel-gray-200',
    warning: 'text-warning',
    error: 'text-error',
  }[variant];

  const textClasses = {
    default: 'text-vercel-gray-200',
    warning: 'text-warning font-medium',
    error: 'text-error',
  }[variant];

  return (
    <div className={`p-3 border rounded-lg ${containerClasses}`}>
      <div className="flex items-center gap-2">
        <svg
          className={`w-4 h-4 ${iconClasses}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          {icons[icon]}
        </svg>
        <span className={`text-sm ${textClasses}`}>{message}</span>
      </div>
    </div>
  );
}

export default Alert;
