/**
 * Alert - Official Design System Atom
 *
 * Subtle alert box for displaying messages (errors, info).
 *
 * @official 2026-01-12
 * @category Atom
 *
 * Token Usage:
 * - Background: vercel-gray-50
 * - Border: vercel-gray-200
 * - Text/Icon: vercel-gray-200
 */

interface AlertProps {
  /** The message to display */
  message: string;
  /** Optional icon type */
  icon?: 'error' | 'info';
}

export function Alert({ message, icon = 'error' }: AlertProps) {
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
  };

  return (
    <div className="p-3 bg-vercel-gray-50 border border-vercel-gray-200 rounded-lg">
      <div className="flex items-center gap-2">
        <svg
          className="w-4 h-4 text-vercel-gray-200"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          {icons[icon]}
        </svg>
        <span className="text-sm text-vercel-gray-200">{message}</span>
      </div>
    </div>
  );
}

export default Alert;
