import type { UnderHoursResource } from '../utils/calculations';

interface UnderHoursAlertProps {
  items: UnderHoursResource[];
  expectedHours: number;
  workingDaysElapsed: number;
  workingDaysTotal: number;
}

export function UnderHoursAlert({ items, expectedHours, workingDaysElapsed, workingDaysTotal }: UnderHoursAlertProps) {
  if (items.length === 0) return null;

  return (
    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
      <div className="flex items-start gap-3">
        <svg
          className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <div className="flex-1">
          <h3 className="font-medium text-amber-800">
            Under Hours Alert: {items.length} resource{items.length !== 1 ? 's' : ''} below {expectedHours.toFixed(1)}hr prorated target
          </h3>
          <p className="text-sm text-amber-600 mt-1">
            Monthly target: 140 hrs | Working days: {workingDaysElapsed} of {workingDaysTotal} (excludes weekends & Bulgarian holidays)
          </p>
          <div className="mt-3 space-y-2">
            {items.map((item) => (
              <div
                key={item.userName}
                className="flex items-center justify-between px-3 py-2 bg-amber-100 rounded"
              >
                <span className="font-medium text-amber-800">{item.userName}</span>
                <div className="text-right">
                  <span className="text-amber-800">
                    {item.actualHours.toFixed(1)}h
                  </span>
                  <span className="text-amber-600 text-sm ml-1">
                    / {item.expectedHours.toFixed(1)}h
                  </span>
                  <span className="text-red-600 text-sm ml-2">
                    (-{item.deficit.toFixed(1)}h)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
