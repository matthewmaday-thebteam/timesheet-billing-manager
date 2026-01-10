import { minutesToHours } from '../utils/calculations';
import { formatCurrency } from '../utils/billing';
import { MetricCard } from './MetricCard';
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

      {/* Resources Under Target - Using MetricCard */}
      <MetricCard
        title="Resources Under Target"
        value={underHoursCount}
        statusColor={hasUnderHours ? 'orange' : 'default'}
        isWarning={hasUnderHours}
        onClick={onUnderHoursClick}
        actionLabel="View"
      />
    </div>
  );
}
