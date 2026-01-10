import { minutesToHours } from '../utils/calculations';
import { formatCurrency } from '../utils/billing';
import type { ProjectSummary, ResourceSummary } from '../types';

interface StatsOverviewProps {
  projects: ProjectSummary[];
  resources: ResourceSummary[];
  underHoursCount: number;
  totalRevenue: number;
  onUnderHoursClick?: () => void;
}

export function StatsOverview({
  projects,
  resources,
  underHoursCount,
  totalRevenue,
  onUnderHoursClick,
}: StatsOverviewProps) {
  const totalMinutes = projects.reduce((sum, p) => sum + p.totalMinutes, 0);
  const hasUnderHours = underHoursCount > 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {/* Total Hours */}
      <div className="p-6 bg-[#FFFFFF] rounded-lg border border-[#EAEAEA]">
        <p className="text-[12px] text-[#666666] mb-1">Total Hours</p>
        <p className="text-2xl font-semibold text-[#000000]">
          {minutesToHours(totalMinutes)}
        </p>
      </div>

      {/* Total Revenue */}
      <div className="p-6 bg-[#FFFFFF] rounded-lg border border-[#EAEAEA]">
        <p className="text-[12px] text-[#666666] mb-1">Total Revenue</p>
        <p className="text-xl font-semibold text-[#000000]">
          {formatCurrency(totalRevenue)}
        </p>
      </div>

      {/* Projects */}
      <div className="p-6 bg-[#FFFFFF] rounded-lg border border-[#EAEAEA]">
        <p className="text-[12px] text-[#666666] mb-1">Projects</p>
        <p className="text-2xl font-semibold text-[#000000]">
          {projects.length}
        </p>
      </div>

      {/* Resources */}
      <div className="p-6 bg-[#FFFFFF] rounded-lg border border-[#EAEAEA]">
        <p className="text-[12px] text-[#666666] mb-1">Resources</p>
        <p className="text-2xl font-semibold text-[#000000]">
          {resources.length}
        </p>
      </div>

      {/* Resources Under Target - Conditional Card Background */}
      <div
        className={`relative p-6 rounded-lg border ${
          hasUnderHours
            ? 'bg-[#FFF7ED] border-[#FFEDD5]'
            : 'bg-[#FFFFFF] border-[#EAEAEA]'
        }`}
      >
        <p className={`text-[12px] mb-1 ${hasUnderHours ? 'text-[#9A3412]' : 'text-[#666666]'}`}>
          Resources Under Target
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span
            className={`w-2 h-2 rounded-full ${
              hasUnderHours ? 'bg-[#F97316]' : 'bg-[#D4D4D4]'
            }`}
          />
          <span className={`text-2xl font-semibold ${hasUnderHours ? 'text-[#C2410C]' : 'text-[#000000]'}`}>
            {underHoursCount}
          </span>
        </div>

        {/* View Button - Pinned to Lower Right */}
        <button
          onClick={onUnderHoursClick}
          className="absolute bottom-3 right-3 flex items-center gap-1 px-3 py-1 bg-[#F5F5F5] border border-[#EAEAEA] rounded-md text-[12px] text-[#666666] hover:bg-[#EBEBEB] hover:border-[#D4D4D4] transition-colors focus:outline-none focus:ring-1 focus:ring-black"
        >
          <span>View</span>
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
      </div>
    </div>
  );
}
