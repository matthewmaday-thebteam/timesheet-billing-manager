/**
 * DateCycle - Month navigation molecule
 *
 * A reusable component for cycling through months with left/right arrows
 * and a centered date display.
 *
 * @category Molecule
 */

import { format, subMonths, addMonths } from 'date-fns';
import { Button } from '../Button';
import { ChevronIcon } from '../ChevronIcon';

export interface DateCycleProps {
  /** Currently selected date */
  selectedDate: Date;
  /** Callback when date changes */
  onDateChange: (newDate: Date) => void;
  /** date-fns format string for display (default: 'MMMM yyyy') */
  formatString?: string;
  /** Size variant (default: 'md', 'lg' is 50% larger) */
  size?: 'sm' | 'md' | 'lg';
  /** Visual variant (default: 'default', 'boxed' adds border container) */
  variant?: 'default' | 'boxed';
  /** Disable navigation */
  disabled?: boolean;
}

export function DateCycle({
  selectedDate,
  onDateChange,
  formatString = 'MMMM yyyy',
  size = 'md',
  variant = 'default',
  disabled = false,
}: DateCycleProps) {
  const handlePrevious = () => {
    onDateChange(subMonths(selectedDate, 1));
  };

  const handleNext = () => {
    onDateChange(addMonths(selectedDate, 1));
  };

  // Size-specific styling
  const sizeConfig = {
    sm: {
      chevronSize: 'sm' as const,
      textSize: 'text-xs',
      minWidth: 'min-w-[100px]',
      buttonSize: 'sm' as const,
      gap: 'gap-2',
      padding: 'px-2 py-1',
    },
    md: {
      chevronSize: 'md' as const,
      textSize: 'text-sm',
      minWidth: 'min-w-[120px]',
      buttonSize: 'md' as const,
      gap: 'gap-2',
      padding: 'px-3 py-2',
    },
    lg: {
      chevronSize: 'lg' as const,
      textSize: 'text-xl',
      minWidth: 'min-w-[180px]',
      buttonSize: 'lg' as const,
      gap: 'gap-3',
      padding: 'px-4 py-3',
    },
  };

  const config = sizeConfig[size];

  // Container classes based on variant
  const containerClasses = variant === 'boxed'
    ? `flex items-center ${config.gap} ${config.padding} border border-vercel-gray-100 rounded-lg bg-white`
    : `flex items-center ${config.gap}`;

  return (
    <div className={containerClasses}>
      <Button
        variant="ghost"
        size={config.buttonSize}
        iconOnly
        onClick={handlePrevious}
        disabled={disabled}
        aria-label="Previous month"
      >
        <ChevronIcon direction="left" size={config.chevronSize} />
      </Button>
      <span className={`${config.textSize} font-medium text-vercel-gray-600 ${config.minWidth} text-center`}>
        {format(selectedDate, formatString)}
      </span>
      <Button
        variant="ghost"
        size={config.buttonSize}
        iconOnly
        onClick={handleNext}
        disabled={disabled}
        aria-label="Next month"
      >
        <ChevronIcon direction="right" size={config.chevronSize} />
      </Button>
    </div>
  );
}

export default DateCycle;
