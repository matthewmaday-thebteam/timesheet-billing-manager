import { minutesToHours } from '../utils/calculations';
import type { ProjectSummary, ResourceSummary } from '../types';

interface StatsOverviewProps {
  projects: ProjectSummary[];
  resources: ResourceSummary[];
  underHoursCount: number;
}

export function StatsOverview({ projects, resources, underHoursCount }: StatsOverviewProps) {
  const totalMinutes = projects.reduce((sum, p) => sum + p.totalMinutes, 0);

  const stats = [
    {
      label: 'Total Hours',
      value: minutesToHours(totalMinutes),
      color: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    {
      label: 'Projects',
      value: projects.length.toString(),
      color: 'bg-green-50 text-green-700 border-green-200',
    },
    {
      label: 'Resources',
      value: resources.length.toString(),
      color: 'bg-purple-50 text-purple-700 border-purple-200',
    },
    {
      label: 'Under Hours',
      value: underHoursCount.toString(),
      color: underHoursCount > 0
        ? 'bg-red-50 text-red-700 border-red-200'
        : 'bg-gray-50 text-gray-700 border-gray-200',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={`p-4 rounded-lg border ${stat.color}`}
        >
          <div className="text-2xl font-bold">{stat.value}</div>
          <div className="text-sm opacity-80">{stat.label}</div>
        </div>
      ))}
    </div>
  );
}
