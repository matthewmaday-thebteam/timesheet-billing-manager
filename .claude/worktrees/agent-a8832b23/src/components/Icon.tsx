import type { ReactNode } from 'react';

interface IconProps {
  /** The icon content (typically an SVG) */
  children?: ReactNode;
  /** Preset icon type - use instead of children for common icons */
  type?: 'chat' | 'user' | 'settings' | 'search';
  /** Size of the icon container */
  size?: 'sm' | 'md' | 'lg';
  /** Visual variant */
  variant?: 'default' | 'primary' | 'brand';
  /** Additional CSS classes */
  className?: string;
}

const containerSizeClasses = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-12 h-12',
};

const iconSizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
};

const variantClasses = {
  default: 'bg-vercel-gray-50 text-vercel-gray-400',
  primary: 'bg-vercel-gray-600 text-white',
  brand: 'bg-bteam-brand text-white',
};

/**
 * Icon - Circular icon container
 *
 * A reusable component that wraps icons in a styled circular container.
 * Supports preset icon types or custom SVG children.
 *
 * @example
 * // Using preset icon type
 * <Icon type="chat" size="md" variant="brand" />
 *
 * @example
 * // Using custom SVG
 * <Icon size="lg" variant="default">
 *   <svg>...</svg>
 * </Icon>
 */
export function Icon({
  children,
  type,
  size = 'md',
  variant = 'default',
  className = ''
}: IconProps) {
  const iconContent = children || (type && getPresetIcon(type));

  return (
    <div
      className={`
        ${containerSizeClasses[size]}
        ${variantClasses[variant]}
        rounded-full
        flex items-center justify-center
        flex-shrink-0
        ${className}
      `}
    >
      <div className={iconSizeClasses[size]}>
        {iconContent}
      </div>
    </div>
  );
}

/**
 * Get SVG for preset icon types
 */
function getPresetIcon(type: 'chat' | 'user' | 'settings' | 'search') {
  const icons = {
    chat: (
      <svg
        className="w-full h-full"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
        />
      </svg>
    ),
    user: (
      <svg
        className="w-full h-full"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
        />
      </svg>
    ),
    settings: (
      <svg
        className="w-full h-full"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    ),
    search: (
      <svg
        className="w-full h-full"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
    ),
  };

  return icons[type];
}
