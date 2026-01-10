interface MetricCardProps {
  title: string;
  value: string | number;
  statusColor?: 'default' | 'green' | 'orange' | 'red';
  isWarning?: boolean;
  onClick?: () => void;
  actionLabel?: string;
}

export function MetricCard({
  title,
  value,
  statusColor = 'default',
  isWarning = false,
  onClick,
  actionLabel,
}: MetricCardProps) {
  // Determine card styling based on warning state
  const cardClasses = isWarning
    ? 'bg-[#FFF7ED] border-[#FFEDD5]'
    : 'bg-[#FFFFFF] border-[#EAEAEA]';

  const titleClasses = isWarning
    ? 'text-[#9A3412]'
    : 'text-[#666666]';

  const valueClasses = isWarning
    ? 'text-[#C2410C]'
    : 'text-[#000000]';

  // Status dot color mapping
  const dotColors = {
    default: 'bg-[#D4D4D4]',
    green: 'bg-[#50E3C2]',
    orange: 'bg-[#F97316]',
    red: 'bg-[#EE0000]',
  };

  const showStatusDot = statusColor !== 'default' || isWarning;
  const dotColor = isWarning ? dotColors.orange : dotColors[statusColor];

  return (
    <div className={`relative p-6 rounded-lg border ${cardClasses}`}>
      <p className={`text-[12px] mb-1 ${titleClasses}`}>{title}</p>

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
          className="absolute bottom-3 right-3 flex items-center gap-1 px-3 py-1 bg-[#F5F5F5] border border-[#EAEAEA] rounded-md text-[12px] text-[#666666] hover:bg-[#EBEBEB] hover:border-[#D4D4D4] transition-colors duration-200 ease-out focus:outline-none focus:ring-1 focus:ring-black"
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
