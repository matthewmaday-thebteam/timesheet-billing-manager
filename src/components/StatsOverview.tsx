import { minutesToHours } from '../utils/calculations';
import { formatCurrency } from '../utils/billing';
import type { ProjectSummary, ResourceSummary } from '../types';

interface StatsOverviewProps {
  projects: ProjectSummary[];
  resources: ResourceSummary[];
  underHoursCount: number;
  totalRevenue: number;
}

export function StatsOverview({ projects, resources, underHoursCount, totalRevenue }: StatsOverviewProps) {
  const totalMinutes = projects.reduce((sum, p) => sum + p.totalMinutes, 0);

  const stats = [
    {
      label: 'Total Hours',
      value: minutesToHours(totalMinutes),
      color: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    {
      label: 'Total Revenue',
      value: formatCurrency(totalRevenue),
      color: 'bg-green-50 text-green-700 border-green-200',
      isLarge: true,
    },
    {
      label: 'Projects',
      value: projects.length.toString(),
      color: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    },
    {
      label: 'Resources',
      value: resources.length.toString(),
      color: 'bg-purple-50 text-purple-700 border-purple-200',
    },
    {
      label: 'Resources Under Target',
      value: underHoursCount.toString(),
      color: underHoursCount > 0
        ? 'bg-red-50 text-red-700 border-red-200'
        : 'bg-gray-50 text-gray-700 border-gray-200',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={`p-4 rounded-lg border ${stat.color}`}
        >
          <div className={`font-bold ${stat.isLarge ? 'text-xl' : 'text-2xl'}`}>{stat.value}</div>
          <div className="text-sm opacity-80">{stat.label}</div>
        </div>
      ))}
    </div>
  );
}
