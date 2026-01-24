/**
 * Toggle - Official Design System Atom
 *
 * A toggle switch with label and optional description.
 * Used for boolean settings like "Send Invite Email".
 *
 * @official 2026-01-12
 * @category Atom
 *
 * Token Usage:
 * - Background: vercel-gray-50 (container), vercel-gray-100/600 (switch)
 * - Border: vercel-gray-100
 * - Text: vercel-gray-600 (label), vercel-gray-400 (description)
 */

interface ToggleProps {
  /** Label text displayed above the toggle */
  label: string;
  /** Optional description text */
  description?: string;
  /** Whether the toggle is on */
  checked: boolean;
  /** Callback when toggle state changes */
  onChange: (checked: boolean) => void;
  /** Whether the toggle is disabled */
  disabled?: boolean;
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: ToggleProps) {
  return (
    <div className="flex items-center justify-between gap-6 p-3 bg-vercel-gray-50 border border-vercel-gray-100 rounded-md">
      <div className="min-w-0">
        <p className="text-sm font-medium text-vercel-gray-600">{label}</p>
        {description && (
          <p className="text-xs text-vercel-gray-400">{description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 ease-out focus:outline-none focus:ring-1 focus:ring-black ${
          checked ? 'bg-bteam-brand' : 'bg-vercel-gray-100'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ease-out ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

export default Toggle;
