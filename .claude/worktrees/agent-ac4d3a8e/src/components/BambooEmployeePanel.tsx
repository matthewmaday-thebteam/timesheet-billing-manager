import { useBambooEmployees } from '../hooks/useBambooEmployees';

export function BambooEmployeePanel() {
  const { employees, availableEmployees, loading, error } = useBambooEmployees();

  if (loading) {
    return (
      <div className="p-6 bg-white border border-vercel-gray-100 rounded-lg">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-vercel-gray-100 rounded w-48" />
          <div className="h-3 bg-vercel-gray-100 rounded w-32" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-white border border-vercel-gray-100 rounded-lg">
        <p className="text-xs font-mono text-vercel-gray-400">BambooHR Employees</p>
        <p className="text-sm text-error mt-1">{error}</p>
      </div>
    );
  }

  if (employees.length === 0) {
    return (
      <div className="p-6 bg-white border border-vercel-gray-100 rounded-lg">
        <p className="text-xs font-mono text-vercel-gray-400">BambooHR Employees</p>
        <p className="text-sm text-vercel-gray-400 mt-2">
          No BambooHR employees synced yet. Run the n8n BambooHR workflow to import.
        </p>
      </div>
    );
  }

  const linkedCount = employees.length - availableEmployees.length;
  const unlinkedCount = availableEmployees.length;

  // Build set of unlinked bamboo_ids for fast lookup
  const unlinkedIds = new Set(availableEmployees.map(e => e.bamboo_id));

  return (
    <div className="p-6 bg-white border border-vercel-gray-100 rounded-lg space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-mono text-vercel-gray-400">BambooHR Employees</p>
          <p className="text-sm text-vercel-gray-400 mt-1">
            {linkedCount} linked
            {unlinkedCount > 0 && (
              <span className="text-bteam-brand font-semibold">
                {' '}&middot; {unlinkedCount} unlinked
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Employee Chips */}
      <div className="flex flex-wrap gap-2">
        {employees.map(emp => {
          const isUnlinked = unlinkedIds.has(emp.bamboo_id);
          const name = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || 'Unknown';

          return (
            <span
              key={emp.id}
              className={
                isUnlinked
                  ? 'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold text-bteam-brand border border-bteam-brand/30 bg-bteam-brand/5'
                  : 'inline-flex items-center px-3 py-1 rounded-full text-xs text-vercel-gray-600 border border-vercel-gray-100 bg-vercel-gray-50'
              }
            >
              {name}
            </span>
          );
        })}
      </div>
    </div>
  );
}
