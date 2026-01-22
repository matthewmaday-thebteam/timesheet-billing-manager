interface MetricCardProps {
  title: string;
  value: string | number;
  statusColor?: 'default' | 'green' | 'orange' | 'red';
  isWarning?: boolean;
  isAlert?: boolean;
  onClick?: () => void;
  actionLabel?: string;
  hideDot?: boolean;
}

export function MetricCard({
  title,
  value,
  statusColor = 'default',
  isWarning = false,
  isAlert = false,
  onClick,
  actionLabel,
  hideDot = false,
}: MetricCardProps) {
  // Determine card styling based on alert/warning state
  const cardClasses = isAlert
    ? 'bg-bteam-brand border-bteam-brand'
    : isWarning
      ? 'bg-warning-light border-warning'
      : 'bg-white border-vercel-gray-100';

  const titleClasses = isAlert
    ? 'text-white'
    : isWarning
      ? 'text-warning-text-dark'
      : 'text-vercel-gray-400';

  const valueClasses = isAlert
    ? 'text-white'
    : isWarning
      ? 'text-warning'
      : 'text-vercel-gray-600';

  // Status dot color mapping
  const dotColors = {
    default: 'bg-vercel-gray-200',
    green: 'bg-success',
    orange: 'bg-warning',
    red: 'bg-error',
  };

  const showStatusDot = !hideDot && !isAlert && (statusColor !== 'default' || isWarning);
  const dotColor = isWarning ? dotColors.orange : dotColors[statusColor];

  // Button classes based on alert state
  const buttonClasses = isAlert
    ? 'bg-white border-white text-bteam-brand hover:bg-bteam-brand-light hover:border-bteam-brand-light'
    : 'bg-vercel-gray-100 border-vercel-gray-100 text-vercel-gray-400 hover:bg-vercel-gray-200 hover:border-vercel-gray-200';

  return (
    <div className={`relative h-full p-6 rounded-lg border ${cardClasses}`}>
      <p className={`text-xs font-mono mb-1 ${titleClasses}`}>{title}</p>

      <div className="flex items-center gap-2 mt-1">
        {showStatusDot && (
          <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        )}
        <span className={`text-2xl font-semibold ${valueClasses}`}>
          {value}
        </span>
      </div>

      {/* Optional Action Button */}
      {onClick && (
        <button
          onClick={onClick}
          className={`absolute bottom-3 right-3 flex items-center gap-1 px-3 py-1 rounded-md text-xs transition-colors duration-200 ease-out focus:outline-none ${buttonClasses}`}
        >
          <span>{actionLabel || 'View'}</span>
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
