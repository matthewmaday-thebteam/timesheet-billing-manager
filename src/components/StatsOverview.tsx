import { useMemo } from 'react';
import { minutesToHours } from '../utils/calculations';
import { ANNUAL_BUDGET, TARGET_RATIO } from '../config/chartConfig';
import { MetricCard } from './MetricCard';
import type { ProjectSummary, ResourceSummary } from '../types';

// Monthly budget and target from annual values
const MONTHLY_BUDGET = ANNUAL_BUDGET / 12;
const MONTHLY_TARGET = (ANNUAL_BUDGET * TARGET_RATIO) / 12;

interface StatsOverviewProps {
  projects: ProjectSummary[];
  /** Canonical project count from v_project_table_entities (per Formulas page definition) */
  projectCount: number;
  resources: ResourceSummary[];
  underHoursCount: number;
  totalRevenue: number;
  utilizationPercent: number;
  onUnderHoursClick?: () => void;
}

export function StatsOverview({
  projects,
  projectCount,
  resources,
  underHoursCount,
  totalRevenue,
  utilizationPercent,
  onUnderHoursClick,
}: StatsOverviewProps) {
  const totalMinutes = projects.reduce((sum, p) => sum + p.totalMinutes, 0);
  const hasUnderHours = underHoursCount > 0;

  // Calculate revenue status
  const revenueStatus = useMemo(() => {
    if (projects.length === 0) {
      return { label: 'No Data', color: 'default' as const };
    }

    const aboveTargetThreshold = MONTHLY_TARGET * 1.05;

    if (totalRevenue >= aboveTargetThreshold) {
      return { label: 'Above Target', color: 'green' as const };
    }
    if (totalRevenue >= MONTHLY_TARGET) {
      return { label: 'On Target', color: 'green' as const };
    }
    if (totalRevenue >= MONTHLY_BUDGET) {
      return { label: 'At Budget', color: 'orange' as const };
    }
    return { label: 'Below Budget', color: 'red' as const };
  }, [projects.length, totalRevenue]);

  return (
    <div className="flex gap-4">
      <div className="w-[15%]">
        <MetricCard
          title="Total Hours"
          value={minutesToHours(totalMinutes)}
        />
      </div>

      <div className="w-[20%]">
        <MetricCard
          title="Utilization"
          value={`${utilizationPercent.toFixed(1)}%`}
        />
      </div>

      <div className="w-[20%]">
        <MetricCard
          title="Status"
          value={revenueStatus.label}
          statusColor={revenueStatus.color}
          hideDot
        />
      </div>

      <div className="w-[10%]">
        <MetricCard
          title="Projects"
          value={projectCount.toLocaleString('en-US')}
        />
      </div>

      <div className="w-[10%]">
        <MetricCard
          title="Resources"
          value={resources.length.toLocaleString('en-US')}
        />
      </div>

      <div className="w-[25%]">
        <MetricCard
          title="Resources Under Target"
          value={underHoursCount}
          isAlert={hasUnderHours}
          onClick={onUnderHoursClick}
          actionLabel="View"
        />
      </div>
    </div>
  );
}
