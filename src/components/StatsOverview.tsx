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
      <MetricCard
        title="Total Hours"
        value={minutesToHours(totalMinutes)}
      />

      <MetricCard
        title="Total Revenue"
        value={formatCurrency(totalRevenue)}
      />

      <MetricCard
        title="Projects"
        value={projects.length}
      />

      <MetricCard
        title="Resources"
        value={resources.length}
      />

      <MetricCard
        title="Resources Under Target"
        value={underHoursCount}
        isAlert={hasUnderHours}
        onClick={onUnderHoursClick}
        actionLabel="View"
      />
    </div>
  );
}
