import { format } from 'date-fns';
import { minutesToHours } from '../utils/calculations';
import { AccordionNested } from './AccordionNested';
import type { AccordionNestedLevel2Item } from './AccordionNested';
import type { ProjectSummary } from '../types';

interface ProjectCardProps {
  project: ProjectSummary;
}

export function ProjectCard({ project }: ProjectCardProps) {
  // Transform project resources into AccordionNested format
  const items: AccordionNestedLevel2Item[] = project.resources.map((resource) => ({
    id: resource.userName,
    label: resource.displayName,
    value: `${minutesToHours(resource.totalMinutes)}h`,
    children: resource.tasks.map((task, index) => ({
      id: `${resource.userName}-${task.taskName}-${index}`,
      label: task.taskName,
      value: `${minutesToHours(task.totalMinutes)}h`,
      details: [
        ...task.entries.slice(0, 5).map(
          (entry) => `${format(new Date(entry.date), 'M/d')}: ${minutesToHours(entry.minutes)}h`
        ),
        ...(task.entries.length > 5 ? [`+${task.entries.length - 5} more`] : []),
      ],
    })),
  }));

  return (
    <AccordionNested
      header={
        <>
          <h3 className="text-sm font-semibold text-vercel-gray-600">{project.projectName}</h3>
          <p className="text-xs font-mono text-vercel-gray-400">
            {project.resources.length} resource{project.resources.length !== 1 ? 's' : ''}
          </p>
        </>
      }
      headerRight={
        <div className="text-right">
          <div className="text-lg font-semibold text-vercel-gray-600">
            {minutesToHours(project.totalMinutes)}h
          </div>
          <div className="text-xs font-mono text-vercel-gray-400">total</div>
        </div>
      }
      items={items}
    />
  );
}
