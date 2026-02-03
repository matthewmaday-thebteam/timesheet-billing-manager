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
  /** Size variant (default: 'md') */
  size?: 'sm' | 'md';
  /** Disable navigation */
  disabled?: boolean;
}

export function DateCycle({
  selectedDate,
  onDateChange,
  formatString = 'MMMM yyyy',
  size = 'md',
  disabled = false,
}: DateCycleProps) {
  const handlePrevious = () => {
    onDateChange(subMonths(selectedDate, 1));
  };

  const handleNext = () => {
    onDateChange(addMonths(selectedDate, 1));
  };

  // Size-specific styling
  const chevronSize = size === 'sm' ? 'sm' : 'md';
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';
  const minWidth = size === 'sm' ? 'min-w-[100px]' : 'min-w-[120px]';
  const buttonSize = size === 'sm' ? 'sm' : 'md';

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size={buttonSize}
        iconOnly
        onClick={handlePrevious}
        disabled={disabled}
        aria-label="Previous month"
      >
        <ChevronIcon direction="left" size={chevronSize} />
      </Button>
      <span className={`${textSize} font-medium text-vercel-gray-600 ${minWidth} text-center`}>
        {format(selectedDate, formatString)}
      </span>
      <Button
        variant="ghost"
        size={buttonSize}
        iconOnly
        onClick={handleNext}
        disabled={disabled}
        aria-label="Next month"
      >
        <ChevronIcon direction="right" size={chevronSize} />
      </Button>
    </div>
  );
}

export default DateCycle;
